const AWS = require('aws-sdk');
const _ = require('lodash');
const fs = require('fs');

class Setec {
  constructor(configOrConfigfile) {
    this.config = Setec.getConfig(configOrConfigfile);

    this.awsConfig = this.config.aws || {};
    AWS.config.update(this.awsConfig);

    this.setecConfig = this.config.setec || {};

    /* eslint-disable no-console */
    this.logger = this.config.logger || console.log;
    /* eslint-enable no-console */
  }

  async loadSecret(awsConfig, setecConfig, secretName) {
    const ssm = new AWS.SSM(awsConfig);

    const prefix = _.get(setecConfig, 'prefix', '');
    const fullSecretName = `${prefix}${secretName}`;

    try {
      const secretObject = await new Promise(
        (resolve, reject) => ssm.getParameter(
          { Name: fullSecretName, WithDecryption: true },
          (err, result) => {
            if (err) reject(err);
            else resolve(result);
          },
        ),
      );

      const secretValue = secretObject.Parameter.Value;

      return secretValue;
    } catch (error) {
      this.logger(`error resolving secret: ${fullSecretName}`);
      this.logger(JSON.stringify({
        message: error.message,
        stack: error.stack,
      }));

      process.exit(1);

      // This is just to avoid a linter error
      return null;
    }
  }

  async loadSecrets(awsConfig, setecConfig, config) {
    if (_.isObject(config)) {
      if (_.has(config, 'secret') && Object.keys(config).length === 1) {
        return this.loadSecret(awsConfig, setecConfig, config.secret);
      }

      const keyValPromises = Object.keys(config).map(async key => [
        key,
        await this.loadSecrets(awsConfig, setecConfig, config[key]),
      ]);

      return Promise
        .all(keyValPromises)
        .then(keyVals => keyVals.reduce(
          (acc, [key, val]) => Object.assign(acc, { [key]: val }),
          {},
        ));
    }

    if (_.isArray(config)) {
      return Promise.all(config.map(value => this.loadSecrets(awsConfig, setecConfig, value)));
    }

    return config;
  }

  static getConfig(configOrConfigfile) {
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

  async assumeRole({ role }) {
    this.logger(`assuming role ${role}`);

    const sts = new AWS.STS();
    const result = await new Promise(
      (resolve, reject) => sts.assumeRole(
        {
          RoleArn: role,
          RoleSessionName: 'local-developer',
          DurationSeconds: 3600,
        },
        (err, assumeResult) => {
          if (err) reject(err);
          else resolve(assumeResult);
        },
      ),
    );

    AWS.config.update({
      accessKeyId: result.Credentials.AccessKeyId,
      secretAccessKey: result.Credentials.SecretAccessKey,
      sessionToken: result.Credentials.SessionToken,
    });

    this.logger(`assumed role ${role}`);
  }

  async load() {
    if (this.loaded) return this.config;

    if (this.awsConfig.role) {
      if (this.config.production) {
        throw new Error(
          'programmatically assuming roles should only be used in non-production environments',
        );
      }

      await this.assumeRole(this.awsConfig);
    }

    const resolvedConfig = await this.loadSecrets(this.awsConfig, this.setecConfig, this.config);
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
