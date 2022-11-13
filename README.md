# OBJY CONNECT - Build a Platform

A JavaScript Framework for building custom platforms on Node.

## What's a platform?

A (digital) platform is a system that brings together data, processes and users in order to archieve a common goal. Think eBay, Facebook, Slack, etc.
Platforms, from a technical perspective must be able to run on any modern infrastructure, must be taylored for the use case and offer all the standard features, users expect (access control, forgot password, etc.)

## Installing

### NPM

```shell
npm install objy-connect
```

## Quick Example


```javascript
// Include OBJY CONNECT (Node.js)
const CONNECT = require('objy-connect');
const OBJY = require('objy');

// define one or more OBJY object types
OBJY.define({
    authable: true,
    name: "user",
    pluralName: "users",
    storage: new Mongo(OBJY).connect('mongodb://localhost', function(data) { }, function(data) { })
})

// Initialize REST Interface
CONNECT.REST({
    port: 80,
    redisCon: {
        port: 6379,
        host: "localhost"
    }
}).run();
```

## How does it work?

CONNECT is built on top of OBJY. Therefore ist uses the "everything is a dynamic, behaviour-driven object" approach. This means that everyth
