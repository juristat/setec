const Setec = require('./');

jest.mock('aws-sdk', () => {
  const mockSSM = {
    getParameter: jest.fn(),
  };

  const mockSTS = {
    assumeRole: jest.fn(),
  };

  return {
    config: {
      update: jest.fn(),
    },
    mockSSM,
    SSM: jest.fn(() => mockSSM),
    mockSTS,
    STS: jest.fn(() => mockSTS),
  };
});

const mockAws = require('aws-sdk');
const noSecretsInput = {
  key: 'value',
  object: { key: 'value' },
  array: ['one', 'two', 'three'],
};

beforeEach(() => jest.clearAllMocks());

test('should load from object', async () => {
  const conf = new Setec(noSecretsInput);
  await conf.load();

  expect(conf.exportable().key).toEqual('value');
  expect(conf.exportable().object).toEqual({ key: 'value' });
  expect(conf.exportable().array).toEqual(['one', 'two', 'three']);

  expect(mockAws.config.update.mock.calls.length).toBe(1);
  expect(mockAws.config.update.mock.calls[0][0]).toEqual({});
});

test('should load from JS file', async () => {
  const conf = new Setec('./test-config.js');
  await conf.load();

  expect(conf.exportable().key).toEqual('value');
  expect(conf.exportable().object).toEqual({ key: 'value' });
  expect(conf.exportable().array).toEqual(['one', 'two', 'three']);

  expect(mockAws.config.update.mock.calls.length).toBe(1);
  expect(mockAws.config.update.mock.calls[0][0]).toEqual({});
});

test('should load from JSON file', async () => {
  const conf = new Setec('./test-config.json');
  await conf.load();

  expect(conf.exportable().key).toEqual('value');
  expect(conf.exportable().object).toEqual({ key: 'value' });
  expect(conf.exportable().array).toEqual(['one', 'two', 'three']);

  expect(mockAws.config.update.mock.calls.length).toBe(1);
  expect(mockAws.config.update.mock.calls[0][0]).toEqual({});
});

test('should throw an error on a load from file with no extension', async () => {
  expect(() => new Setec('./test-config')).toThrow(/no extension/);
});

test('should throw an error on a load from unknown file type', async () => {
  expect(() => new Setec('./test-config.foo')).toThrow(/unknown extension/);
});

test('should throw an error on invalid input', async () => {
  expect(() => new Setec()).toThrow(/Invalid config/);
});

test('should set AWS config from imported config', async () => {
  const conf = new Setec({
    aws: { test: 1 },
  });
  await conf.load();

  expect(mockAws.config.update.mock.calls.length).toBe(1);
  expect(mockAws.config.update.mock.calls[0][0]).toEqual({ test: 1 });
});

test('should assume an AWS role from the config', async () => {
  mockAws.mockSTS.assumeRole.mockImplementation((input, cb) => {
    cb(null, {
      Credentials: {
        AccessKeyId: 'accessKeyId',
        SecretAccessKey: 'secretAccessKey',
        SessionToken: 'sessionToken',
      },
    });
  });

  const conf = new Setec({ aws: { test: 1, role: 'roleName' } });

  await conf.load();

  expect(mockAws.mockSTS.assumeRole.mock.calls.length).toBe(1);
  expect(mockAws.mockSTS.assumeRole.mock.calls[0][0]).toEqual({
    RoleArn: 'roleName',
    RoleSessionName: 'local-developer',
    DurationSeconds: 3600,
  });

  expect(mockAws.config.update.mock.calls.length).toBe(2);
  expect(mockAws.config.update.mock.calls[0][0]).toEqual({ test: 1 });
  expect(mockAws.config.update.mock.calls[1][0]).toEqual({
    accessKeyId: 'accessKeyId',
    secretAccessKey: 'secretAccessKey',
    sessionToken: 'sessionToken',
  });
});

test('should assume a failed assume role', async () => {
  mockAws.mockSTS.assumeRole.mockImplementation((input, cb) => cb(new Error('bad stuff')));

  const conf = new Setec({ aws: { test: 1, role: 'roleName' } });
  await expect(conf.load()).rejects.toThrow(/unable to assume role.*bad stuff/);
});

test('should refuse to assume a role in production', async () => {
  const conf = new Setec({
    production: true,
    aws: { test: 1, role: 'roleName' },
  });

  await expect(conf.load()).rejects.toThrow(/will not assume/);
});

test('should load secrets', async () => {
  mockAws.mockSSM.getParameter.mockImplementation(
    ({ Name: name, WithDecryption: withDecryption }, cb) => {
      expect(withDecryption).toBe(true);
      cb(null, { Parameter: { Value: name } });
    },
  );

  const conf = new Setec({
    topLevel: { secret: 'topLevel-secret' },
    object: {
      nested: { secret: 'nested-secret' },
    },
    array: [
      { secret: 'array-secret' }
    ],
  });

  await conf.load();

  expect(conf.exportable().topLevel).toBe('topLevel-secret');
  expect(conf.exportable().object.nested).toBe('nested-secret');
  expect(conf.exportable().array[0]).toBe('array-secret');

  // Testing to ensure that the load function only loads secrets the first time
  await conf.load();
  expect(mockAws.mockSSM.getParameter.mock.calls.length).toBe(3);
});

test('should throw an error on a faild secret loading', async () => {
  mockAws.mockSSM.getParameter.mockImplementation((input, cb) => { cb(new Error('bad stuff')); });

  const conf = new Setec({ topLevel: { secret: 'topLevel-secret' } });

  await expect(conf.load()).rejects.toThrow(/error resolving secret.*bad stuff/);
});
