'use strict';

var logger = require('logger');
var JSONAPISerializer = require('jsonapi-serializer').Serializer;
var quiccAlertsSerializer = new JSONAPISerializer('quicc-alerts', {
    attributes: ['value', 'period', 'min_date', 'max_date','downloadUrls'],
    typeForAttribute: function (attribute, record) {
        return attribute;
    },
    downloadUrls:{
        attributes: ['csv', 'geojson', 'kml', 'shp', 'svg']
    }
});

class QuiccAlertsSerializer {

  static serialize(data) {
    return quiccAlertsSerializer.serialize(data);
  }
}

module.exports = QuiccAlertsSerializer;
