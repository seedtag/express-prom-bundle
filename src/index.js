"use strict";

const
    PromFactory = require("./PromFactory"),
    onFinished = require("on-finished"),
    pidusage = require('pidusage'),
    os = require("os");

function matchVsRegExps(element, regexps) {
    for (let regexp of regexps) {
        if (regexp instanceof RegExp) {
            if (element.match(regexp)) {
                return true;
            }
        } else if (element == regexp) {
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
            throw new Error("you cannot have whitelist and blacklist at the same time");
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
    opts = opts === undefined ? {} : opts;
    if (arguments[2] && arguments[1] && arguments[1].send) {
        arguments[1].status(500)
            .send("<h1>500 Error</h1>\n"
                + "<p>Unexapected 3d param in express-prom-bundle.\n"
                + "<p>Did you just put express-prom-bundle into app.use "
                + "without calling it as a function first?");
        return;
    }

    const factory = new PromFactory(opts);

    const metricTemplates = {
        "up": () => factory.newGauge(
            "up",
            "1 = up, 0 = not up"
        ),
        "nodejs_memory_heap_total_bytes": () => factory.newGauge(
            "nodejs_memory_heap_total_bytes",
            "value of process.memoryUsage().heapTotal"
        ),
        "nodejs_memory_heap_used_bytes": () => factory.newGauge(
            "nodejs_memory_heap_used_bytes",
            "value of process.memoryUsage().heapUsed"
        ),
        "http_request_seconds": () => {
            const metric = factory.newHistogram(
                "http_request_seconds",
                "number of http responses labeled with status code",
                ["status_code"],
                {
                    buckets: opts.buckets || [0.003, 0.03, 0.1, 0.3, 1.5, 10]
                }
            );
            return metric;
        },
        "cpu": () => factory.newGauge(
            "cpu", 
            "cpu usage"
        ),
        "memory": () => factory.newGauge(
            "memory", 
            "memory usage"
        ),
        "load1": () => factory.newGauge(
            "load1", 
            "average 1-minute load"
        ),
        "load5": () => factory.newGauge(
            "load5", 
            "average 5-minutes load"
        ),
        "load15": () => factory.newGauge(
            "load15", 
            "average 15-minutes load"
        ),
    };

    const
        metrics = {},
        names = prepareMetricNames(opts, metricTemplates);


    for (let name of names) {
        metrics[name] = metricTemplates[name]();
    }

    if (metrics.up) {
        metrics.up.set(1);
    }

    const middleware = function (req, res, next) {
        if (req.path == "/metrics") {
            let memoryUsage = process.memoryUsage();
            if (metrics["nodejs_memory_heap_total_bytes"]) {
                metrics["nodejs_memory_heap_total_bytes"].set(memoryUsage.heapTotal);
            }
            if (metrics["nodejs_memory_heap_used_bytes"]) {
                metrics["nodejs_memory_heap_used_bytes"].set(memoryUsage.heapUsed);
            }
            if (metrics["cpu"] || metrics["memory"]) {
                pidusage.stat(process.pid, (err, stat) => {
                    if (err) {
                        console.error(err);
                    } else {
                        console.log(stat);
                        if (metrics["cpu"]) {
                            metrics["cpu"].set(stat.cpu);
                        }
                        if (metrics["memory"]) {
                            metrics["memory"].set(stat.memory / 1024 / 1024);
                        }
                    }
                });
                pidusage.unmonitor(process.pid);
            }
            if (metrics["load1"] || metrics["load5"] || metrics["load15"]) {
                const load = os.loadavg();
                const load1 = load[0];
                const load5 = load[1];
                const load15 = load[2];
                if (metrics["load1"]) {
                    metrics["load1"].set(load1);
                }
                if (metrics["load5"]) {
                    metrics["load5"].set(load5);
                }
                if (metrics["load15"]) {
                    metrics["load15"].set(load15);
                }
            }
            res.contentType("text/plain")
                .send(factory.promClient.register.metrics());
            return;
        }

        if (opts.excludeRoutes && matchVsRegExps(req.path, opts.excludeRoutes)) {
            return next();
        }

        let labels;
        if (metrics["http_request_seconds"]) {
            labels = {"status_code": 0};
            let timer = metrics["http_request_seconds"].startTimer(labels);
            onFinished(res, () => {
                labels["status_code"] = res.statusCode;
                timer();
            });
        }

        next();
    };

    middleware.factory = factory;
    middleware.metricTemplates = metricTemplates;
    middleware.metrics = metrics;
    middleware.promClient = factory.promClient;

    return middleware;
}

module.exports = main;
