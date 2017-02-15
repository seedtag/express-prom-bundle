'use strict';
const onFinished = require('on-finished');
const promClient = require('prom-client');
const normalizePath = require('./normalizePath');
const os = require('os');
const usage = new (require('./usage'))();

function matchVsRegExps(element, regexps) {
  for (let regexp of regexps) {
    if (regexp instanceof RegExp) {
      if (element.match(regexp)) {
        return true;
      }
    } else if (element === regexp) {
      return true;
    }
  }
  return false;
}

function filterArrayByRegExps(array, regexps) {
  return array.filter(element => {
    return matchVsRegExps(element, regexps);
  });
}

function prepareMetricNames(opts, metricTemplates) {
  const names = Object.keys(metricTemplates);
  if (opts.whitelist) {
    if (opts.blacklist) {
      throw new Error('you cannot have whitelist and blacklist at the same time');
    }
    return filterArrayByRegExps(names, opts.whitelist);
  }
  if (opts.blacklist) {
    const blacklisted = filterArrayByRegExps(names, opts.blacklist);
    return names.filter(name => blacklisted.indexOf(name) === -1);
  }
  return names;
}

function main(opts) {
  opts = Object.assign({autoregister: true}, opts);
  if (arguments[2] && arguments[1] && arguments[1].send) {
    arguments[1].status(500)
      .send('<h1>500 Error</h1>\n'
        + '<p>Unexpected 3rd param in express-prom-bundle.\n'
        + '<p>Did you just put express-prom-bundle into app.use '
        + 'without calling it as a function first?');
    return;
  }

  if (opts.prefix || opts.keepDefaultMetrics !== undefined) {
    throw new Error(
      'express-prom-bundle detected obsolete options:'
      + 'prefix and/or keepDefaultMetrics. '
      + 'Please refer to oficial docs. '
      + 'Most likely you upgraded the module without necessary code changes'
    );
  }

  const httpMetricName = opts.httpDurationMetricName || 'http_request_seconds';

  const metricTemplates = {
    'up': () => new promClient.Gauge(
      'up',
      '1 = up, 0 = not up'
    ),
    http_request_duration_seconds: () => {
      const labels = ['status_code'];
      if (opts.includeMethod) {
        labels.push('method');
      }
      if (opts.includePath) {
        labels.push('path');
      }
      const metric = new promClient.Histogram(
        httpMetricName,
        'duration histogram of http responses labeled with: ' + labels.join(', '),
        labels,
        {
          buckets: opts.buckets || [0.003, 0.03, 0.1, 0.3, 1.5, 10]
        }
      );
      return metric;
    },
    'nodejs_cpu': () => new promClient.Gauge(
      'nodejs_cpu',
      'cpu usage'
    ),
    'nodejs_memory': () => new promClient.Gauge(
      'nodejs_memory',
      'memory usage'
    ),
    'nodejs_load1': () => new promClient.Gauge(
      'nodejs_load1',
      'average 1-minute load'
    ),
    'nodejs_load5': () => new promClient.Gauge(
      'nodejs_load5',
      'average 5-minute load'
    ),
    'nodejs_load15': () => new promClient.Gauge(
      'nodejs_load15',
      'average 15-minute load'
    ),
  };

  const metrics = {};
  const names = prepareMetricNames(opts, metricTemplates);

  for (let name of names) {
    metrics[name] = metricTemplates[name]();
  }

  if (metrics.up) {
    metrics.up.set(1);
  }

  const metricsMiddleware = function(req, res) {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end(promClient.register.metrics());
  };

  const middleware = function (req, res, next) {
    const path = req.originalUrl;
    let labels;

    if (opts.autoregister && path.match(/^\/metrics\/?$/)) {
      return metricsMiddleware(req, res);
    }

    if (opts.excludeRoutes && matchVsRegExps(path, opts.excludeRoutes)) {
      return next();
    }

    if (metrics.http_request_duration_seconds) {
      labels = {'status_code': 0};
      let timer = metrics.http_request_duration_seconds.startTimer(labels);
      onFinished(res, () => {
        labels.status_code = res.statusCode;
        if (opts.includeMethod) {
          labels.method = req.method;
        }
        if (opts.includePath) {
          labels.path = main.normalizePath(req, opts);
        }
        timer();
      });
    }
    if (metrics['nodejs_cpu'] || metrics['nodejs_memory']) {
      const usageValue = usage.get;
      if (metrics['nodejs_cpu']) {
        metrics['nodejs_cpu'].set(usageValue.cpu);
      }
      if (metrics['nodejs_memory']) {
        metrics['nodejs_memory'].set(usageValue.memory / 1024 / 1024);
      }
    }
    if (metrics['nodejs_load1'] || metrics['nodejs_load5'] || metrics['nodejs_load15']) {
      const load = os.loadavg();
      const load1 = load[0];
      const load5 = load[1];
      const load15 = load[2];
      if (metrics['nodejs_load1']) {
        metrics['nodejs_load1'].set(load1);
      }
      if (metrics['nodejs_load5']) {
        metrics['nodejs_load5'].set(load5);
      }
      if (metrics['nodejs_load15']) {
        metrics['nodejs_load15'].set(load15);
      }
    }

    next();
  };

  middleware.metricTemplates = metricTemplates;
  middleware.metrics = metrics;
  middleware.promClient = promClient;
  middleware.metricsMiddleware = metricsMiddleware;
  return middleware;
}

main.promClient = promClient;
main.normalizePath = normalizePath;
module.exports = main;
