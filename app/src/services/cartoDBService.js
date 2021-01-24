const logger = require('logger');
const config = require('config');
const CartoDB = require('cartodb');
const Mustache = require('mustache');
const NotFound = require('errors/notFound');
const JSONAPIDeserializer = require('jsonapi-serializer').Deserializer;
const { RWAPIMicroservice } = require('rw-api-microservice-node');

const WORLD = `SELECT COUNT(pt.*) AS value
            {{additionalSelect}}
        FROM quicc_alerts pt
        WHERE pt.date >= '{{begin}}'::date
            AND pt.date <= '{{end}}'::date
            AND ST_INTERSECTS(
                ST_SetSRID(ST_GeomFromGeoJSON('{{{geojson}}}'), 4326), the_geom) `;

const ISO = `SELECT COUNT(pt.*) AS value
            {{additionalSelect}}
        FROM quicc_alerts pt,
            (SELECT * FROM gadm2_countries_simple
             WHERE iso = UPPER('{{iso}}')) as p
        WHERE ST_Intersects(pt.the_geom, p.the_geom)
            AND pt.date >= '{{begin}}'::date
            AND pt.date <= '{{end}}'::date `;

const ID1 = `SELECT COUNT(pt.*) AS value
            {{additionalSelect}}
        FROM quicc_alerts pt,
            (SELECT * FROM gadm2_provinces_simple
             WHERE iso = UPPER('{{iso}}') AND id_1 = {{id1}}) as p
        WHERE ST_Intersects(pt.the_geom, p.the_geom)
            AND pt.date >= '{{begin}}'::date
            AND pt.date <= '{{end}}'::date `;

const USE = `SELECT COUNT(pt.*) AS value
            {{additionalSelect}}
        FROM quicc_alerts pt,
            (SELECT * FROM {{useTable}} WHERE cartodb_id = {{pid}}) as p
        WHERE ST_Intersects(pt.the_geom, p.the_geom)
            AND pt.date >= '{{begin}}'::date
            AND pt.date <= '{{end}}'::date `;

const WDPA = `SELECT COUNT(pt.*) AS value
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

const LATEST = `SELECT DISTINCT date
        FROM quicc_alerts
        WHERE date IS NOT NULL
        ORDER BY date DESC
        LIMIT {{limit}}`;

const MIN_MAX_DATE_SQL = ', MIN(date) as min_date, MAX(date) as max_date ';

const executeThunk = (client, sql, params) => (callback) => {
    logger.debug(Mustache.render(sql, params));
    client.execute(sql, params).done((data) => {
        callback(null, data);
    }).error((err) => {
        callback(err, null);
    });
};

const deserializer = (obj) => (callback) => {
    new JSONAPIDeserializer({ keyForAttribute: 'camelCase' }).deserialize(obj, callback);
};


const getToday = () => {
    const today = new Date();
    return `${today.getFullYear().toString()}-${(today.getMonth() + 1).toString()}-${today.getDate().toString()}`;
};

const getYesterday = () => {
    const yesterday = new Date(Date.now() - (24 * 60 * 60 * 1000));
    return `${yesterday.getFullYear().toString()}-${(yesterday.getMonth() + 1).toString()}-${yesterday.getDate().toString()}`;
};


const defaultDate = () => {
    const to = getToday();
    const from = getYesterday();
    return `${from},${to}`;
};

const getPeriodText = (period) => {
    const periods = period.split(',');
    const days = (new Date(periods[1]) - new Date(periods[0])) / (24 * 60 * 60 * 1000);

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

    constructor() {
        this.client = new CartoDB.SQL({
            user: config.get('cartoDB.user')
        });
        this.apiUrl = config.get('cartoDB.apiUrl');
    }

    // eslint-disable-next-line consistent-return
    getDownloadUrls(query, params) {
        try {
            const formats = ['csv', 'geojson', 'kml', 'shp', 'svg'];
            const download = {};
            let queryFinal = Mustache.render(query, params);
            logger.debug('antes de reemplazar', queryFinal);
            queryFinal = queryFinal.replace(MIN_MAX_DATE_SQL, '');
            logger.debug('antes de reemplazar', queryFinal);

            // eslint-disable-next-line no-useless-escape
            queryFinal = queryFinal.replace('SELECT COUNT(pt.\*) AS value', 'SELECT pt.*');
            logger.debug('despues de reemplazar', queryFinal);
            queryFinal = encodeURIComponent(queryFinal);
            for (let i = 0, { length } = formats; i < length; i++) {
                download[formats[i]] = `${this.apiUrl}?q=${queryFinal}&format=${formats[i]}`;
            }
            return download;
        } catch (err) {
            logger.error(err);
        }
    }

    * getNational(iso, alertQuery, period = defaultDate()) {
        logger.debug('Obtaining national of iso %s', iso);
        const periods = period.split(',');
        const params = {
            iso,
            begin: periods[0],
            end: periods[1]
        };
        if (alertQuery) {
            params.additionalSelect = MIN_MAX_DATE_SQL;
        }
        const data = yield executeThunk(this.client, ISO, params);
        if (data.rows && data.rows.length > 0) {
            const result = data.rows[0];
            result.period = getPeriodText(period);
            result.downloadUrls = this.getDownloadUrls(ISO, params);
            return result;
        }
        return null;
    }

    * getSubnational(iso, id1, alertQuery, period = defaultDate()) {
        logger.debug('Obtaining subnational of iso %s and id1', iso, id1);
        const periods = period.split(',');
        const params = {
            iso,
            id1,
            begin: periods[0],
            end: periods[1]
        };
        if (alertQuery) {
            params.additionalSelect = MIN_MAX_DATE_SQL;
        }
        const data = yield executeThunk(this.client, ID1, params);
        if (data.rows && data.rows.length > 0) {
            const result = data.rows[0];
            result.period = getPeriodText(period);
            result.downloadUrls = this.getDownloadUrls(ID1, params);
            return result;
        }
        return null;
    }

    * getUse(useTable, id, alertQuery, period = defaultDate()) {
        logger.debug('Obtaining use with id %s', id);
        const periods = period.split(',');
        const params = {
            useTable,
            pid: id,
            begin: periods[0],
            end: periods[1]
        };
        if (alertQuery) {
            params.additionalSelect = MIN_MAX_DATE_SQL;
        }
        const data = yield executeThunk(this.client, USE, params);

        if (data.rows && data.rows.length > 0) {
            const result = data.rows[0];
            result.period = getPeriodText(period);
            result.downloadUrls = this.getDownloadUrls(USE, params);
            return result;
        }
        return null;
    }

    * getWdpa(wdpaid, alertQuery, period = defaultDate()) {
        logger.debug('Obtaining wpda of id %s', wdpaid);
        const periods = period.split(',');
        const params = {
            wdpaid,
            begin: periods[0],
            end: periods[1]
        };
        if (alertQuery) {
            params.additionalSelect = MIN_MAX_DATE_SQL;
        }
        const data = yield executeThunk(this.client, WDPA, params);
        if (data.rows && data.rows.length > 0) {
            const result = data.rows[0];
            result.period = getPeriodText(period);
            result.downloadUrls = this.getDownloadUrls(WDPA, params);
            return result;
        }
        return null;
    }

    // eslint-disable-next-line class-methods-use-this
    * getGeostore(hashGeoStore) {
        logger.debug('Obtaining geostore with hash %s', hashGeoStore);
        try {
            const result = yield RWAPIMicroservice.requestToMicroservice({
                uri: `/geostore/${hashGeoStore}`,
                method: 'GET',
                json: true
            });

            return yield deserializer(result);
        } catch (error) {
            logger.warn('Error obtaining geostore:');
            logger.warn(error);
            return null;
        }
    }

    * getWorld(hashGeoStore, alertQuery, period = defaultDate()) {
        logger.debug('Obtaining world with hashGeoStore %s', hashGeoStore);

        const geostore = yield this.getGeostore(hashGeoStore);
        if (geostore && geostore.geojson) {
            logger.debug('Executing query in cartodb with geostore', geostore);
            const periods = period.split(',');
            const params = {
                geojson: JSON.stringify(geostore.geojson.features[0].geometry),
                begin: periods[0],
                end: periods[1]
            };
            if (alertQuery) {
                params.additionalSelect = MIN_MAX_DATE_SQL;
            }
            const data = yield executeThunk(this.client, WORLD, params);
            if (data.rows && data.rows.length > 0) {
                const result = data.rows[0];
                result.period = getPeriodText(period);
                result.downloadUrls = this.getDownloadUrls(WORLD, params);
                return result;
            }
            return null;
        }
        throw new NotFound('Geostore not found');
    }

    * latest(limit = 3) {
        logger.debug('Obtaining latest with limit %s', limit);
        const params = {
            limit
        };
        const data = yield executeThunk(this.client, LATEST, params);
        logger.debug('data', data);
        if (data.rows) {
            const result = data.rows;
            return result;
        }
        return null;
    }

}

module.exports = new CartoDBService();
