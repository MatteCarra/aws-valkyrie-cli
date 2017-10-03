'use strict';

const AWS = require('aws-sdk');
const { getAWSCredentials, getProjectInfo, breakChain, generateRetryFn } = require('../utils');
const inquirer = require('inquirer');

module.exports = {
  description: 'Delete an existing Valkyrie application;',
  fn: ({ l }, valkconfig = null) => new Promise((resolve, reject) => {
    const programmaticDeletion = valkconfig !== null;
    if (!valkconfig) valkconfig = getProjectInfo().valkconfig;

    const awsCredentials = { credentials: getAWSCredentials() };
    const { Region: region } = valkconfig.Project;
    const iam = new AWS.IAM(awsCredentials);
    const lambda = new AWS.Lambda(Object.assign({ region }, awsCredentials));
    const apiGateway = new AWS.APIGateway(Object.assign({ region }, awsCredentials));
    const envNames = Object.keys(valkconfig.Environments);
    const envValues = Object.values(valkconfig.Environments);
    (() => {
      if (!programmaticDeletion) {
        return inquirer.prompt([{ type: 'confirm', name: 'confirm', message: 'All AWS infrastructure related to this project will be deleted and it will be impossible to restore it, including roles and policies. Continue?', default: false }]).then(({ confirm }) => {
          if (!confirm) {
            l.log('process aborted;');
            breakChain();
          }
        });
      }
      else return Promise.resolve();
    })()
      .then(() => Promise.all(envValues.map(({ Iam }) => { if (Iam && Iam.PolicyArn && Iam.RoleName) return iam.detachRolePolicy({ PolicyArn: Iam.PolicyArn, RoleName: Iam.RoleName }).promise(); })))
      .then(results => results.forEach((data, i) => { if (data) l.success(`${envValues[i].Iam.PolicyArn} detached from ${envValues[i].Iam.RoleName};`); }))
      .catch(l.warning)

      .then(() => Promise.all(envValues.map(({ Iam }) => { if (Iam && Iam.PolicyArn) return iam.deletePolicy({ PolicyArn: Iam.PolicyArn }).promise(); })))
      .then(results => results.forEach((data, i) => { if (data) l.success(`${envValues[i].Iam.PolicyArn} ${envNames[i]} policy deleted;`); }))
      .catch(l.warning)

      .then(() => Promise.all(envValues.map(({ Iam }) => { if (Iam && Iam.RoleName) return iam.deleteRole({ RoleName: Iam.RoleName }).promise(); })))
      .then(results => results.forEach((data, i) => { if (data) l.success(`${envValues[i].Iam.RoleName} role deleted;`); }))
      .catch(l.warning)

      .then(() => Promise.all(envValues.map(({ Lambda }) => { if (Lambda && Lambda.FunctionName) return lambda.deleteFunction({ FunctionName: Lambda.FunctionName }).promise(); })))
      .then(results => results.forEach((data, i) => { if (data) l.success(`${envValues[i].Lambda.FunctionName} lambda deleted;`); }))
      .catch(l.warning)

      .then(() => {
        if (envValues.length && envValues[0].Api && envValues[0].Api.Id) l.wait(`deleting api${envValues.length > 1 ? 's' : ''}`);
        return Promise.all(envValues.map(async ({ Api }) => {
          if (Api && Api.Id) {
            const deleteApi = generateRetryFn(() => apiGateway.deleteRestApi({ restApiId: Api.Id }).promise());
            return await deleteApi();
          }
        }));
      })
      .then(results => results.forEach((data, i) => { if (data) l.success(`${envValues[i].Api.Id} ${envNames[i]} API deleted;`); }))
      .catch(l.warning)

      .then(() => l.success('deletion completed;'))
      .then(resolve)
      .catch(err => {
        if (err.chainBraker) resolve();
        else reject(err);
      });
  })
};
