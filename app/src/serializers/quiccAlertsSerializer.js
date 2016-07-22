'use strict';

var logger = require('logger');
var JSONAPISerializer = require('jsonapi-serializer').Serializer;
var quiccAlertsSerializer = new JSONAPISerializer('quicc-alerts', {
    attributes: ['value', 'period', 'min_date', 'max_date', 'downloadUrls'],
    typeForAttribute: function(attribute, record) {
        return attribute;
    },
    downloadUrls: {
        attributes: ['csv', 'geojson', 'kml', 'shp', 'svg']
    },
    keyForAttribute: 'camelCase'
});

var quiccLatestSerializer = new JSONAPISerializer('imazon-latest', {
    attributes: ['date'],
    typeForAttribute: function(attribute, record) {
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
