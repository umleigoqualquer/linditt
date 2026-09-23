const serverless = require('serverless-http');
const app = require('./_lib/app');

exports.handler = serverless(app);
