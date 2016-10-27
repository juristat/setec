# Setec

## Description
A simple system for managing secrets using AWS S3 and KMS.

## Installation

### Command Line Client
```
npm install -g setec

echo '{
    "s3-bucket": "my-bucket",
    "s3-prefix": "my-prefix"
}' > ~/.setec
```

### In Your Project
```
npm install setec
```

## Usage

### Command Line
#### List secrets
```
setec list
```

#### Set the value of a secret
If the secret already exists, the value will simply be updated.  If the secret doesn't exist, than a new object for the secret will be created in S3, a new key will be created to encrypt the plaintext, and a new AWS policy will be created to allow you to grant access to the secret.
```
setec set <key> <value>
```

#### Get the value of a secret
Will throw an error if the secret does not exist.
```
setec get <key>
```

In Your Project
```javascript
const Setec = require('setec');

const secrets = new Setec({
    "s3-bucket": "my-bucket",
    "s3-prefix": "my-prefix"
}); secrets.get('database-password').then(dbPassword => {
    const db = new Database("user-not-a-secret", dbPassword);
});
```
