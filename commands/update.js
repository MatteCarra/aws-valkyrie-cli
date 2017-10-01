'use strict';
const { promisify } = require('util');
const zipdir = promisify(require('zip-dir'));
const inquirer = require('inquirer');
const argv = require('simple-argv');
const { getProjectInfo, getAWSCredentials, getRequiredEnv, breakChain, getEnvColor } = require('../utils');
const AWS = require('aws-sdk');

module.exports = {
  description: 'Updates you function code and/or configurations;',
  flags: [
    {
      name: 'staging',
      description: 'Updates staging Lambda;'
    },
    {
      name: 'production',
      description: 'Updates production Lambda;'
    },
    {
      name: 'code',
      description: 'Updates just the code part;'
    },
    {
      name: 'config',
      description: 'Updates just the configuration;'
    }
  ],
  fn: ({ l }) => new Promise((resolve, reject) => {
    const { valkconfig, root } = getProjectInfo();

    const vars = {};
    Promise.resolve()
      .then(() => getRequiredEnv(valkconfig))
      .then(answers => Object.assign(vars, answers))
      .then(() => {
        if (!argv.code && !argv.config) {
          return inquirer.prompt([
            { type: 'checkbox', name: 'update', message: 'what do you want to update?:', choices: [{ name: 'code', checked: true }, { name: 'config', checked: false }], validate: (choices) => choices.length ? true : 'select at least one;' }
          ]);
        } else return { update: ['code', 'config'].filter(e => argv[e]) };
      })
      .then(answers => Object.assign(vars, answers))
      .then(() => {
        if (vars.env === 'production') return inquirer.prompt([{
          type: 'confirm', name: 'confirm', message: `you are about to update Lambda ${vars.update.join(' and ')} in ${l.colors[getEnvColor('production')]}production${l.colors.white}. Continue?`, default: false
        }]);
        return { confirm: true };
      })
      .then(({ confirm }) => { if (!confirm) breakChain(); })
      .then(() => {
        const promises = [];
        const lambda = new AWS.Lambda(Object.assign({ region: valkconfig.Project.Region }, { credentials: getAWSCredentials() }));
        const envColor = vars.envColor = l.colors[getEnvColor(vars.env)];
        const { env, update } = vars;

        l.wait(`updating ${envColor}${env}${l.colors.reset} Lambda ${update.join(' and ')}...`);
        if (update.includes('code')) promises.push(new Promise((resolve, reject) => {
          zipdir(root)
            .then(ZipFile => lambda.updateFunctionCode({ FunctionName: valkconfig.Environments[env].Lambda.FunctionName, ZipFile }).promise())
            .then(resolve)
            .catch(reject);
        }));

        if (update.includes('config')) promises.push(lambda.updateFunctionConfiguration(valkconfig.Environments[env].Lambda).promise());
        return Promise.all(promises);
      })
      .then(([data]) => {
        const { env, update, envColor } = vars;
        l.success(`${envColor}${env}${l.colors.reset} Lambda ${update.join(' and ')} updated${update.includes('config') ? `:\n${JSON.stringify(data, null, 2)}` : ''}`);
      })
      .then(resolve)
      .catch(err => {
        if (err.chainBraker) resolve();
        else reject(err);
      });
  })
};
