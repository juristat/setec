const AWS     = require('aws-sdk');
const Promise = require('bluebird');
const _       = require('lodash');

module.exports = class Setec {
	constructor(opts) {
		this.s3Bucket = opts['s3-bucket'];
		this.s3Prefix = opts['s3-prefix'];

		if (!_.isString(this.s3Bucket)) throw new Error('invalid S3 bucket');
		if (!_.isString(this.s3Prefix)) throw new Error('invalid S3 prefix');

		const managingUsersList = opts['managing-users'];

		this.managingUsers = managingUsersList ? managingUsersList.split(',') : [];

		this.s3  = new AWS.S3();
		this.kms = new AWS.KMS();
		this.sts = new AWS.STS();
		this.iam = new AWS.IAM();
	}

	// Returns an array of strings representing all the secrets available.
	list() {
		return new Promise((resolve, reject) => {
			this.s3.listObjects({
				Bucket: this.s3Bucket,
				Prefix: this.s3Prefix,
			}, (err, resp) => {
				if (err) reject(err);
				else resolve(resp.Contents.map(o => {
					return o.Key.replace(new RegExp('^' + this.s3Prefix + '/'), '');
				}));
			});	
		});
	}

	// Takes the name of a secret, and if the user has permission, returns the plain text value.
	get(secret) {
		return Promise.resolve()
		.then(() => new Promise((resolve, reject) => {
			this.s3.getObject({
				Bucket: this.s3Bucket,
				Key:    this.getSecretObjectKey(secret),
			}, (err, resp) => {
				if (err) reject(err);
				else     resolve(resp.Body);
			});
		}))
		.then(object => new Promise((resolve, reject) => {
			this.kms.decrypt({ CiphertextBlob: object }, (err, resp) => {
				if (err) reject(err);
				else     resolve(resp.Plaintext.toString('utf-8'));
			});
		}));
	}

	// Takes the name of a secret and the desired value.  If the secret exists, it updates the
	// value.  If the secret doesn't exist, it creates a key specifically for the secret and a
	// policy to allow users / roles to access the secret, then puts the secret value into S3.
	set(secret, value) {
		return Promise.resolve()
		.then(() => this.createOrGetSecretKey(secret))
		.then(key => new Promise((resolve, reject) => {
			this.kms.encrypt({
				KeyId:     key,
				Plaintext: value,
			}, (err, resp) => {
				if (err) reject(err);
				else     resolve(resp.CiphertextBlob);
			});
		}))
		.then(encryptedValue => new Promise((resolve, reject) => {
			this.s3.putObject({
				Bucket: this.s3Bucket,
				Key:    this.getSecretObjectKey(secret),
				Body:   encryptedValue,
			}, (err, resp) => {
				if (err) reject(err);
				else     resolve();
			});
		}));
	}

	getSecretKeyName(secret)   { return `Setec-Secret-Key-${secret}`.replace(/[^a-zA-Z0-9:/_-]/g, '_') }
	getSecretObjectKey(secret) { return `${this.s3Prefix}/Setec-Secret-${secret}`                      }

	getSecretKey(secret) {
		return new Promise((resolve, reject) => {
			this.kms.describeKey({ KeyId: 'alias/' + this.getSecretKeyName(secret) }, (err, resp) => {
				if (err) reject(err);
				else     resolve(resp.KeyMetadata.Arn);
			});
		});
	}

	getCurrentUser() {
		return new Promise((resolve, reject) => {
			this.sts.getCallerIdentity({}, (err, resp) => {
				if (err) reject(err);
				else     resolve(resp.Arn);
			})
		});
	}

	getRootUser() {
		return new Promise((resolve, reject) => {
			this.sts.getCallerIdentity({}, (err, resp) => {
				if (err) reject(err);
				else     resolve(`arn:aws:iam::${resp.Account}:root`);
			})
		});
	}

	getManagingUsers() {
		return Promise.all([
			this.getRootUser(),
			this.getCurrentUser(),
			this.managingUsers
		])
		.then(_.flatten);
	}

	getNewKeyPolicy() {
		return Promise.resolve()
		.then(() => this.getManagingUsers())
		.then(users => ({
			Version:   '2012-10-17',
			Id:        'Setec-Secret-Policy',
			Statement: [{
				Sid:       'Allow management by users',
				Effect:    'Allow',
				Principal: { AWS: users },
				Action:    'kms:*',
				Resource:  '*',
			}],
		}))
		.then(JSON.stringify);
	}

	createSecretKey(secret) {
		return Promise.resolve()
		.then(() => this.getNewKeyPolicy())
		.then(policy => new Promise((resolve, reject) => {
			const opts = {
				Description: this.getSecretKeyName(secret),
				KeyUsage:    'ENCRYPT_DECRYPT',
				Origin:      'AWS_KMS',
				Policy:      policy,
			};

			this.kms.createKey(opts, (err, resp) => {
				if (err) reject(err);
				else     resolve(resp.KeyMetadata.Arn);
			});
		}))
		.tap(keyId => new Promise((resolve, reject) => {
			this.kms.createAlias(
				{
					AliasName:   'alias/' + this.getSecretKeyName(secret),
					TargetKeyId: keyId
				},
				(err, resp) => {
					if (err) reject(err);
					else     resolve();
				}
			);
		}))
		.tap(keyId => new Promise((resolve, reject) => {
			const policy = {
				Version:   '2012-10-17',
				Statement: [
					{
						Effect: 'Allow',
						Action: [
							'kms:Encrypt',          'kms:Decrypt',     'kms:ReEncrypt*',
							'kms:GenerateDataKey*', 'kms:DescribeKey',
						],
						Resource: [ keyId ],
					},
					{
						Effect:   'Allow',
						Action:   [ 's3:*' ],
						Resource: [ `arn:aws:s3:::${this.s3Bucket}/${this.getSecretObjectKey(secret)}` ],
					},
				]
			};

			const cleanedSecretName = secret.replace(/[^0-9a-z]/ig, '-');

			this.iam.createPolicy(
				{
					PolicyDocument: JSON.stringify(policy),
					PolicyName:     `Setec-Secret-${cleanedSecretName}-Read-Write`,
					Description:    `Setec-Secret-${cleanedSecretName}-Read-Write`,
				},
				(err, resp) => {
					if (err) reject(err);
					else     resolve();
				}
			);
		}));
	}

	createOrGetSecretKey(secret) {
		return Promise.resolve()
		.then(() => this.getSecretKey(secret))
		.catch((err) => {
			if (/not found/.test(err.message)) {
				console.error(`secret key ${this.getSecretKeyName(secret)} not found, creating`);

				return this.createSecretKey(secret);
			}

			throw err;
		});
	}
};
