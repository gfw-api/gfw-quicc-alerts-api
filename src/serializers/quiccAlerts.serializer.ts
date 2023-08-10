import { Serializer } from 'jsonapi-serializer';

const quiccAlertsSerializer: Serializer = new Serializer('quicc-alerts', {
    attributes: ['value', 'period', 'min_date', 'max_date', 'downloadUrls'],
    typeForAttribute: (attribute: string) => attribute,

    downloadUrls: {
        attributes: ['csv', 'geojson', 'kml', 'shp', 'svg']
    },
    keyForAttribute: 'camelCase'
});

const quiccLatestSerializer: Serializer = new Serializer('imazon-latest', {
    attributes: ['date'],
    typeForAttribute: (attribute: string) => attribute,

});


class QuiccAlertsSerializer {

    static serialize(data: Record<string, any>): Record<string, any> {
        return quiccAlertsSerializer.serialize(data);
    }

    static serializeLatest(data: Record<string, any>): Record<string, any> {
        return quiccLatestSerializer.serialize(data);
    }

}

export default QuiccAlertsSerializer;
