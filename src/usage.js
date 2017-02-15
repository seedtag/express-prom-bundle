'use strict';
const pidusage = require('pidusage');

module.exports = class Usage {
  constructor() {
    this.cpu = 50;
    this.memory = 0;
    this.update();
    setInterval(() => {
      this.update();
    }, 15000);
  }

  update() {
    pidusage.stat(process.pid, (err, stat) => {
      this.memory = stat.memory;
      this.cpu = stat.cpu;
    });
  }

  get get() {
    return {cpu: this.cpu, memory: this.memory};
  }
};
