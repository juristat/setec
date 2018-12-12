const Promise = require('bluebird');
const AWS = require('aws-sdk');
const _ = require('lodash');
const fs = require('fs');

async function loadSecret(awsConfig, setecConfig, secretName) {
  const ssm = new AWS.SSM(awsConfig);

  const prefix = _.get(setecConfig, 'prefix', '');
  const fullSecretName = `${prefix}${secretName}`;

  try {
    const secretObject = await Promise.fromCallback(
      cb => ssm.getParameter({ Name: fullSecretName, WithDecryption: true }, cb),
    );

    const secretValue = secretObject.Parameter.Value;

    return secretValue;
  } catch (error) {
    console.log(`error resolving secret: ${fullSecretName}`);
    console.dir(error);

    process.exit(1);

    // This is just to avoid a linter error
    return null;
  }
}

function loadSecrets(awsConfig, setecConfig, config) {
  if (_.isObject(config)) {
    if (_.has(config, 'secret') && Object.keys(config).length === 1) {
      return loadSecret(awsConfig, setecConfig, config.secret);
    }

    return Promise.props(_.mapValues(config, value => loadSecrets(awsConfig, setecConfig, value)));
  }

  if (_.isArray(config)) {
    return Promise.map(config, value => loadSecrets(awsConfig, setecConfig, value));
  }

  return config;
}

function getConfig(configOrConfigfile) {
  if (_.isString(configOrConfigfile)) {
    const configFile = configOrConfigfile;
    const ext = configFile.split('.').pop();
    const hasExt = /\/[^/]+\.[^.]+$/.test(configFile);

    /* eslint-disable global-require, import/no-dynamic-require */
    if (!hasExt) throw new Error("Don't know what to do with a configFile with no extension");
    else if (ext === 'json') return JSON.parse(fs.readFileSync(configFile));
    else if (ext === 'js') return require(configFile);
    else throw new Error(`Don't know what to do with a configFile ending in .${ext}`);
    /* eslint-enable global-require, import/no-dynamic-require */
  }

  if (_.isObject(configOrConfigfile)) return configOrConfigfile;

  throw new Error('Invalid config, must be either a string filename or object');
}

async function assumeRole({ role }) {
  console.log(`assuming role ${role}`);

  const sts = new AWS.STS();
  const result = await Promise.fromCallback(
    cb => sts.assumeRole({
      RoleArn: role,
      RoleSessionName: 'local-developer',
    }, cb),
  );

  AWS.config.update({
    accessKeyId: result.Credentials.AccessKeyId,
    secretAccessKey: result.Credentials.SecretAccessKey,
    sessionToken: result.Credentials.SessionToken,
  });

  console.log(`assumed role ${role}`);
}

class Setec {
  constructor(configOrConfigfile) {
    this.config = getConfig(configOrConfigfile);

    this.awsConfig = this.config.aws || {};
    AWS.config.update(this.awsConfig);

    this.setecConfig = this.config.setec || {};
  }

  async load() {
    if (this.loaded) return this.config;

    if (this.awsConfig.role) {
      if (this.config.production) {
        throw new Error('programmatically assuming roles should only be used in non-production environments');
      }

      await assumeRole(this.awsConfig);
    }

    const resolvedConfig = await loadSecrets(this.awsConfig, this.setecConfig, this.config);
    Object.assign(this.config, resolvedConfig);
    this.loaded = true;

    return this.config;
  }

  exportable() {
    this.config.load = this.load.bind(this);
    return this.config;
  }
}

module.exports = Setec;
