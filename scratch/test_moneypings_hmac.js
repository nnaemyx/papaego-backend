const crypto = require('crypto');
const secret = 'whsec_9150a8620b22cdac2d1623ac183b62696ce54f4668874a9e';
const body = '{"event":"webhook.test","id":"whk_8200b021615d3dea7929778357ecdf81","timestamp":"2026-09-21T21:05:08.875Z","data":{"test":true,"message":"Test event requested with POST /api/partner/webhooks/test. No money moved. Answer with any 2xx."}}';

const expected = '92245d97eb3d2216fd07b8d21d9f37e5e23cd34e56723fe67c9f99aa5455bbd3';

const sig1 = crypto.createHmac('sha256', secret).update(body).digest('hex');
console.log('Result with current secret:', sig1);
console.log('Expected:', expected);
console.log('Match?', sig1 === expected);

const withoutPrefix = secret.replace('whsec_', '');
const sig2 = crypto.createHmac('sha256', withoutPrefix).update(body).digest('hex');
console.log('Result without whsec_:', sig2);

