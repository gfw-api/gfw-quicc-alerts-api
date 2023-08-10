import config from 'config';
import logger from 'logger';
import Mustache from 'mustache';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import CartoDB from 'cartodb';
import { Deserializer } from "jsonapi-serializer";
import { RWAPIMicroservice } from "rw-api-microservice-node";
import ErrorSerializer from "serializers/error.serializer";
import NotFound from "errors/notFound";


const WORLD: string = `SELECT COUNT(pt.*) AS value
            {{additionalSelect}}
        FROM quicc_alerts pt
        WHERE pt.date >= '{{begin}}'::date
            AND pt.date <= '{{end}}'::date
            AND ST_INTERSECTS(
                ST_SetSRID(ST_GeomFromGeoJSON('{{{geojson}}}'), 4326), the_geom) `;

const ISO: string = `SELECT COUNT(pt.*) AS value
            {{additionalSelect}}
        FROM quicc_alerts pt,
            (SELECT * FROM gadm2_countries_simple
             WHERE iso = UPPER('{{iso}}')) as p
        WHERE ST_Intersects(pt.the_geom, p.the_geom)
            AND pt.date >= '{{begin}}'::date
            AND pt.date <= '{{end}}'::date `;

const ID1: string = `SELECT COUNT(pt.*) AS value
            {{additionalSelect}}
        FROM quicc_alerts pt,
            (SELECT * FROM gadm2_provinces_simple
             WHERE iso = UPPER('{{iso}}') AND id_1 = {{id1}}) as p
        WHERE ST_Intersects(pt.the_geom, p.the_geom)
            AND pt.date >= '{{begin}}'::date
            AND pt.date <= '{{end}}'::date `;

const USE: string = `SELECT COUNT(pt.*) AS value
            {{additionalSelect}}
        FROM quicc_alerts pt,
            (SELECT * FROM {{useTable}} WHERE cartodb_id = {{pid}}) as p
        WHERE ST_Intersects(pt.the_geom, p.the_geom)
            AND pt.date >= '{{begin}}'::date
            AND pt.date <= '{{end}}'::date `;

const WDPA: string = `SELECT COUNT(pt.*) AS value
            {{additionalSelect}}
        FROM quicc_alerts pt,
            (SELECT CASE when marine::numeric = 2 then null
        when ST_NPoints(the_geom)<=18000 THEN the_geom
       WHEN ST_NPoints(the_geom) BETWEEN 18000 AND 50000 THEN ST_RemoveRepeatedPoints(the_geom, 0.001)
      ELSE ST_RemoveRepeatedPoints(the_geom, 0.005)
       END as the_geom FROM wdpa_protected_areas where wdpaid={{wdpaid}}) as p
        WHERE ST_Intersects(pt.the_geom, p.the_geom)
            AND pt.date >= '{{begin}}'::date
            AND pt.date <= '{{end}}'::date  `;

const LATEST: string = `SELECT DISTINCT date
        FROM quicc_alerts
        WHERE date IS NOT NULL
        ORDER BY date DESC
        LIMIT {{limit}}`;

const MIN_MAX_DATE_SQL: string = ', MIN(date) as min_date, MAX(date) as max_date ';

const executeThunk = async (client: CartoDB.SQL, sql: string, params: any): Promise<Record<string, any>> => (new Promise((resolve: (value: (PromiseLike<unknown> | unknown)) => void, reject: (reason?: any) => void) => {
    logger.debug(Mustache.render(sql, params));
    client.execute(sql, params).done((data: Record<string, any>) => {
        resolve(data);
    }).error((error: ErrorSerializer) => {
        reject(error);
    });
}));

const getToday = (): string => {
    const today: Date = new Date();
    return `${today.getFullYear().toString()}-${(today.getMonth() + 1).toString()}-${today.getDate().toString()}`;
};

const getYesterday = (): string => {
    const yesterday: Date = new Date(Date.now() - (24 * 60 * 60 * 1000));
    return `${yesterday.getFullYear().toString()}-${(yesterday.getMonth() + 1).toString()}-${yesterday.getDate().toString()}`;
};


const defaultDate = (): string => {
    const to: string = getToday();
    const from: string = getYesterday();
    return `${from},${to}`;
};

const getPeriodText = (period: string): string => {
    const periods: string[] = period.split(',');
    const days: number = (new Date(periods[1]).getTime() - new Date(periods[0]).getTime()) / (24 * 60 * 60 * 1000);

    switch (days) {

        case 1:
            return 'Past 24 hours';
        case 2:
            return 'Past 48 hours';
        case 3:
            return 'Past 72 hours';
        default:
            return 'Past week';

    }
};

class CartoDBService {

    client: CartoDB.SQL;
    apiUrl: string;

    constructor() {
        this.client = new CartoDB.SQL({
            user: config.get('cartoDB.user')
        });
        this.apiUrl = config.get('cartoDB.apiUrl');
    }

    getDownloadUrls(query: string, params: Record<string, any>): Record<string, any> | void {
        try {
            const formats: string[] = ['csv', 'geojson', 'kml', 'shp', 'svg'];
            const download: Record<string, any> = {};
            let queryFinal: string = Mustache.render(query, params);
            logger.debug('antes de reemplazar', queryFinal);
            queryFinal = queryFinal.replace(MIN_MAX_DATE_SQL, '');
            logger.debug('antes de reemplazar', queryFinal);

            // eslint-disable-next-line no-useless-escape
            queryFinal = queryFinal.replace('SELECT COUNT(pt.\*) AS value', 'SELECT pt.*');
            logger.debug('despues de reemplazar', queryFinal);
            queryFinal = encodeURIComponent(queryFinal);
            for (let i: number = 0, { length } = formats; i < length; i++) {
                download[formats[i]] = `${this.apiUrl}?q=${queryFinal}&format=${formats[i]}`;
            }
            return download;
        } catch (err) {
            logger.error(err);
        }
    }

    async getNational(iso: string, alertQuery: string, period: string = defaultDate()): Promise<Record<string, any> | void> {
        logger.debug('Obtaining national of iso %s', iso);
        const periods: string[] = period.split(',');
        const params: { iso: string; end: string; begin: string, additionalSelect?: string } = {
            iso,
            begin: periods[0],
            end: periods[1]
        };
        if (alertQuery) {
            params.additionalSelect = MIN_MAX_DATE_SQL;
        }
        const data: Record<string, any> = await executeThunk(this.client, ISO, params);
        if (data.rows && data.rows.length > 0) {
            const result: Record<string, any> = data.rows[0];
            result.period = getPeriodText(period);
            result.downloadUrls = this.getDownloadUrls(ISO, params);
            return result;
        }
        return null;
    }

    async getSubnational(iso: string, id1: string, alertQuery: string, period: string = defaultDate()): Promise<Record<string, any> | void> {
        logger.debug('Obtaining subnational of iso %s and id1', iso, id1);
        const periods: string[] = period.split(',');
        const params: { iso: string; id1: string; end: string; begin: string, additionalSelect?: string } = {
            iso,
            id1,
            begin: periods[0],
            end: periods[1]
        };
        if (alertQuery) {
            params.additionalSelect = MIN_MAX_DATE_SQL;
        }
        const data: Record<string, any> = await executeThunk(this.client, ID1, params);
        if (data.rows && data.rows.length > 0) {
            const result: Record<string, any> = data.rows[0];
            result.period = getPeriodText(period);
            result.downloadUrls = this.getDownloadUrls(ID1, params);
            return result;
        }
        return null;
    }

    async getUse(useTable: string, id: string, alertQuery: string, period: string = defaultDate()): Promise<Record<string, any> | void> {
        logger.debug('Obtaining use with id %s', id);
        const periods: string[] = period.split(',');
        const params: { pid: any; end: string; useTable: any; begin: string, additionalSelect?: string } = {
            useTable,
            pid: id,
            begin: periods[0],
            end: periods[1],
        };
        if (alertQuery) {
            params.additionalSelect = MIN_MAX_DATE_SQL;
        }
        const data: Record<string, any> = await executeThunk(this.client, USE, params);

        if (data.rows && data.rows.length > 0) {
            const result: Record<string, any> = data.rows[0];
            result.period = getPeriodText(period);
            result.downloadUrls = this.getDownloadUrls(USE, params);
            return result;
        }
        return null;
    }

    async getWdpa(wdpaid: string, alertQuery: string, period: string = defaultDate()): Promise<Record<string, any> | void> {
        logger.debug('Obtaining wpda of id %s', wdpaid);
        const periods: string[] = period.split(',');
        const params: { end: string; begin: string; wdpaid: any, additionalSelect?: string } = {
            wdpaid,
            begin: periods[0],
            end: periods[1]
        };
        if (alertQuery) {
            params.additionalSelect = MIN_MAX_DATE_SQL;
        }
        const data: Record<string, any> = await executeThunk(this.client, WDPA, params);
        if (data.rows && data.rows.length > 0) {
            const result: Record<string, any> = data.rows[0];
            result.period = getPeriodText(period);
            result.downloadUrls = this.getDownloadUrls(WDPA, params);
            return result;
        }
        return null;
    }

    async getGeostore(hashGeoStore: string, apiKey: string): Promise<Record<string, any> | void> {
        logger.debug('Obtaining geostore with hash %s', hashGeoStore);
        try {
            const result: Record<string, any> = await RWAPIMicroservice.requestToMicroservice({
                uri: `/v1/geostore/${hashGeoStore}`,
                method: 'GET',
                headers: {
                    'x-api-key': apiKey,
                }
            });

            return await new Deserializer({
                keyForAttribute: 'camelCase'
            }).deserialize(result);
        } catch (error) {
            logger.warn('Error obtaining geostore:');
            logger.warn(error);
            return null;
        }
    }

    async getWorld(hashGeoStore: string, alertQuery: string, period: string = defaultDate(), apiKey: string): Promise<Record<string, any> | void> {
        logger.debug('Obtaining world with hashGeoStore %s', hashGeoStore);

        const geostore: Record<string, any> | void = await this.getGeostore(hashGeoStore, apiKey);
        if (geostore && geostore.geojson) {
            logger.debug('Executing query in cartodb with geostore', geostore);
            const periods: string[] = period.split(',');
            const params: { geojson: string; end: string; begin: string, additionalSelect?: string } = {
                geojson: JSON.stringify(geostore.geojson.features[0].geometry),
                begin: periods[0],
                end: periods[1]
            };
            if (alertQuery) {
                params.additionalSelect = MIN_MAX_DATE_SQL;
            }
            const data: Record<string, any> = await executeThunk(this.client, WORLD, params);
            if (data.rows && data.rows.length > 0) {
                const result: Record<string, any> = data.rows[0];
                result.period = getPeriodText(period);
                result.downloadUrls = this.getDownloadUrls(WORLD, params);
                return result;
            }
            return null;
        }
        throw new NotFound('Geostore not found');
    }

    async latest(limit: string = "3"): Promise<Record<string, any>> {
        const parserdLimit: number = parseInt(limit, 10);
        logger.debug('Obtaining latest with limit %s', parserdLimit);
        const params: { limit: number } = {
            limit: parserdLimit
        };
        const data: Record<string, any> = await executeThunk(this.client, LATEST, params);
        logger.debug('data', data);
        if (data.rows) {
            const result: Record<string, any> = data.rows;
            return result;
        }
        return null;
    }

}

export default new CartoDBService();
