const JSONAPISerializer = require('jsonapi-serializer').Serializer;

const quiccAlertsSerializer = new JSONAPISerializer('quicc-alerts', {
    attributes: ['value', 'period', 'min_date', 'max_date', 'downloadUrls'],
    typeForAttribute(attribute) {
        return attribute;
    },
    downloadUrls: {
        attributes: ['csv', 'geojson', 'kml', 'shp', 'svg']
    },
    keyForAttribute: 'camelCase'
});

const quiccLatestSerializer = new JSONAPISerializer('imazon-latest', {
    attributes: ['date'],
    typeForAttribute(attribute) {
        return attribute;
    }
});

class QuiccAlertsSerializer {

    static serialize(data) {
        return quiccAlertsSerializer.serialize(data);
    }

    static serializeLatest(data) {
        return quiccLatestSerializer.serialize(data);
    }

}

module.exports = QuiccAlertsSerializer;
