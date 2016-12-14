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

### In Your Project
I reccomend only setting secrets from the command line, and using the javascript client specifically to retrieve them at runtime.
```javascript
const Setec = require('setec');

const secrets = new Setec({
    "s3-bucket": "my-bucket",
    "s3-prefix": "my-prefix"
});

secrets.get('database-password').then(dbPassword => {
    const db = new Database("user-not-a-secret", dbPassword);
});
```

# Legal

Copyright 2016 Datanalytics, Inc. d/b/a Juristat.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this library except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
