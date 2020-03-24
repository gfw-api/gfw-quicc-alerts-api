const Router = require('koa-router');
const logger = require('logger');
const CartoDBService = require('services/cartoDBService');
const NotFound = require('errors/notFound');
const QuiccAlertsSerializer = require('serializers/quiccAlertsSerializer');


const router = new Router({
    prefix: '/quicc-alerts'
});

class QuiccAlertsRouter {

    static* getNational() {
        logger.info('Obtaining national data');
        const data = yield CartoDBService.getNational(this.params.iso, this.query.alertQuery, this.query.period);

        this.body = QuiccAlertsSerializer.serialize(data);
    }

    static* getSubnational() {
        logger.info('Obtaining subnational data');
        const data = yield CartoDBService.getSubnational(this.params.iso, this.params.id1, this.query.alertQuery, this.query.period);
        this.body = QuiccAlertsSerializer.serialize(data);
    }

    static* use() {
        logger.info('Obtaining use data with name %s and id %s', this.params.name, this.params.id);
        let useTable = null;
        switch (this.params.name) {

            case 'mining':
                useTable = 'gfw_mining';
                break;
            case 'oilpalm':
                useTable = 'gfw_oil_palm';
                break;
            case 'fiber':
                useTable = 'gfw_wood_fiber';
                break;
            case 'logging':
                useTable = 'gfw_logging';
                break;
            default:
                this.throw(400, 'Name param invalid');

        }
        if (!useTable) {
            this.throw(404, 'Name not found');
        }
        const data = yield CartoDBService.getUse(useTable, this.params.id, this.query.alertQuery, this.query.period);
        this.body = QuiccAlertsSerializer.serialize(data);

    }

    static* wdpa() {
        logger.info('Obtaining wpda data with id %s', this.params.id);
        const data = yield CartoDBService.getWdpa(this.params.id, this.query.alertQuery, this.query.period);
        this.body = QuiccAlertsSerializer.serialize(data);
    }

    static* world() {
        logger.info('Obtaining world data');
        this.assert(this.query.geostore, 400, 'GeoJSON param required');
        try {
            const data = yield CartoDBService.getWorld(this.query.geostore, this.query.alertQuery, this.query.period);

            this.body = QuiccAlertsSerializer.serialize(data);
        } catch (err) {
            if (err instanceof NotFound) {
                this.throw(404, 'Geostore not found');
                return;
            }
            throw err;
        }

    }

    static* latest() {
        logger.info('Obtaining latest data');
        const data = yield CartoDBService.latest(this.query.limit);
        this.body = QuiccAlertsSerializer.serializeLatest(data);
    }

}

const isCached = function* isCached(next) {
    if (yield this.cashed()) {
        return;
    }
    yield next;
};


router.get('/admin/:iso', isCached, QuiccAlertsRouter.getNational);
router.get('/admin/:iso/:id1', isCached, QuiccAlertsRouter.getSubnational);
router.get('/use/:name/:id', isCached, QuiccAlertsRouter.use);
router.get('/wdpa/:id', isCached, QuiccAlertsRouter.wdpa);
router.get('/', isCached, QuiccAlertsRouter.world);
router.get('/latest', isCached, QuiccAlertsRouter.latest);


module.exports = router;
