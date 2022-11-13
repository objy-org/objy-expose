var express = require('express');
var cors = require('cors');
var bodyParser = require('body-parser');
var moment = require("moment")
var Redis = require("ioredis");
var jwt = require('jsonwebtoken');
var bcrypt = require('bcryptjs');
var app = express();
var router = express.Router();
var shortid = require('shortid');
var defaultSecret = 'asdgnm0923t923';
var defaultMaxUserSessions = 20;
var fileUpload = require('express-fileupload');
var Duplex = require("stream").Duplex;
var isStream = require('is-stream');


// Helper functions
function propsSerialize(obj) {
    if (obj.properties) {
        var propsObj = {};
        var i;
        for (i = 0; i < obj.properties.length; i++) {
            if (obj.properties[i].type == 'bag' || obj.properties[i].type == 'array')
                propsSerialize(obj.properties[i]);
            if (typeof obj.properties[i].name == 'undefined') obj.properties[i].name = CONNECT.RANDOM();
            propsObj[obj.properties[i].name] = obj.properties[i];
            if (propsObj[obj.properties[i].permissions]) propsObj[obj.properties[i].permissions] = permSerialize(propsObj[obj.properties[i].permissions]);
            delete obj.properties[i].name;
        }
        obj.properties = propsObj;
    }
}

Platform = function(CONNECT, OBJY, options) {

    OBJY.Logger.log("Platform options: " + options);

    this.router = router;

    var redis;

    if (options.redisCon) {
        redis = new Redis(options.redisCon);
    } else redis = new Redis("redis://localhost");

    var objectFamilies = options.objectFamilies || [];

    app.use(function(req, res, next) {
        OBJY.activeApp = undefined;
        if (req.headers.metaPropPrefix) CONNECT.metaPropPrefix = req.headers.metaPropPrefix;
        next();
    })

    app.use(bodyParser.urlencoded({
        extended: true
    }));
    app.use(bodyParser.json({
        limit: '300mb'
    }));
    app.use(cors());
    app.use(fileUpload());
    app.options('*', cors());

    OBJY.hello();

    var metaMapper = options.metaMapper;
    var messageMapper = options.messageMapper;

    var checkObjectFamily = function(req, res, next) {
        if (objectFamilies.indexOf(req.params.entity) == -1 && !objectFamilies.length == 0) {
            res.status(500).json({
                message: 'Object Family not available for this interface'
            })
        }
        next();
    }

    var checkAuthentication = function(req, res, next) {

        var token;

        if (req.headers.authorization) {
            token = req.headers.authorization.slice(7, req.headers.authorization.length)
        } else if (req.query.token) {
            token = req.query.token
        }

        jwt.verify(token, options.jwtSecret || defaultSecret, function(err, decoded) {
            if (err) return res.status(401).send({
                auth: false,
                message: 'Failed to authenticate token'
            });

            redis.get('at_' + decoded.tokenId, function(err, result) {

                OBJY.Logger.log("Got token from redis " + result);

                if (err || !result) return res.status(401).send({
                    auth: false,
                    message: 'Failed to authenticate token'
                });

                req.user = decoded

                if (req.user) OBJY.useUser(req.user);

                if ((decoded.clients || []).indexOf(req.params.client) == -1 && (decoded.clients || []).length > 0) return res.status(401).send({
                    auth: false,
                    message: 'Failed to authenticate token'
                });

                next()
            });
        });
    }

    // Welcome
    router.route(['/'])

        .get(function(req, res) {
            res.json({
                message: "Hi there"
            })
        })

    // Request a client activation key
    router.route(['/client/register'])

        .post(function(req, res) {

            var data = req.body;

            if (!data.email) {
                res.status(400);
                res.json({
                    error: 'No email address provided'
                });
                return;
            }

            metaMapper.createClientRegistration(function(data) {

                messageMapper.send((options.clientRegistrationMessage || {}).from || 'SPOO', req.body.email, (options.clientRegistrationMessage || {}).subject || 'your workspace registration key', ((options.clientRegistrationMessage || {}).body || '').replace('__KEY__', data.key) || data.key)

                res.json({
                    message: 'workspace registration key sent!'
                })

            }, function(err) {
                res.status(400)
                res.json({
                    error: err
                })
            })

        })


    // Redeem a client activation key -> create a client
    router.route(['/client'])

        .post(function(req, res) {

            var reqdata = req.body;

            if (!req.body.registrationKey) {
                res.status(404);
                res.json({
                    error: 'No activation key found'
                });
                return;
            }

            reqdata.clientname = reqdata.clientname.replace(/\s/g, '');
            reqdata.clientname = reqdata.clientname.toLowerCase();

            metaMapper.redeemClientRegistration(req.body.registrationKey, function(data) {

                metaMapper.createClient(req.body.registrationKey, reqdata.clientname, function(data) {

                    res.json(data)

                }, function(err) {
                    res.status(400);
                    res.json(err)
                })

            }, function(err) {
                res.status(400);
                res.json(err)
            })

        })


    router.route(['/client/:client/authenticated', '/client/:client/app/:app/authenticated'])

        .get(checkAuthentication, function(req, res) {

            res.status(200);
            res.json({
                authenticated: true
            });
            return;
        });


    router.route(['/client/:client/application'])

        .post(checkAuthentication, function(req, res) {

            var client = req.params.client;

            var appData = req.body;
            var appKey = Object.keys(appData)[0];

            try {

                metaMapper.addClientApplication(appData, function(data) {
                    res.json(data);
                }, function(err) {
                    res.status(400);
                    res.json({
                        error: 'Some Error occured'
                    });
                }, client);
            } catch (e) {
                res.status(400);
                res.json({ error: e });
            }

        });

    router.route(['/client/:client/applications'])

        .get(checkAuthentication, function(req, res) {

            var client = req.params.client;
            console.log('letsgo');
            try {
                metaMapper.getClientApplications(function(data) {

                    console.log('clientapps', data);

                    var _data = [];

                    if (req.query.name) {
                        data.forEach(function(d) {
                            if (d.displayName.toLowerCase().indexOf(req.query.name.toLowerCase()) != -1) _data.push(d)
                        })
                    } else _data = data;

                    console.log('ru', req.user);

                    if (!req.user.spooAdmin) {
                        var i;
                        for (i = 0; i < _data.length; i++) {
                            if (!req.user.privileges[data[i].name]) _data.splice(i, 1);
                        }
                    }

                    console.log('clientapps after:', _data);
                    /* _data.forEach(function(d, i) {

                         //if (req.user.applications.indexOf(d.name) == -1) _data.splice(i, 1);
                         //if (!req.applications.privileges[d.name]) _data.splice(i, 1);

                         if(!req.user.spooAdmin && !req.user.privileges[d.name]) _data.splice(i, 1);
                     })*/

                    res.json(_data)

                }, function(err) {
                    res.status(400);
                    res.json({
                        error: 'Some Error occured'
                    });
                }, client);

            } catch (e) {
                res.status(400);
                res.json({ error: e });
            }

        });

    router.route('/client/:client/user/requestkey')

        .post(function(req, res) {

            var data = req.body;

            if (!data.email) {
                res.status(400);
                res.json({
                    error: 'No email address provided'
                });
                return;
            } else if (/\S+@\S+/.test(data.email) == false) {
                res.status(400);
                res.json({
                    error: 'email not valid'
                });
                return;
            }

            metaMapper.createUserRegistrationKey(data.email, req.params.client, function(data) {

                messageMapper.send((options.userRegistrationMessage || {}).from || 'SPOO', req.body.email, (options.userRegistrationMessage || {}).subject || 'your registration key', ((options.userRegistrationMessage || {}).body || '').replace('__KEY__', data.key) || data.key)

                res.json({
                    message: 'registration key sent!'
                })
            }, function(err) {
                res.status(400);
                res.json({
                    error: err
                });
            })

        });



    router.route('/client/:client/user/requestpasswordreset')

        .post(function(req, res) {

            var data = req.body;

            var client = req.params.client || client;

            if (!data.email) {
                res.status(400);
                res.json({
                    error: 'Neither email nor username provided'
                });
                return;
            } else if (data.email && /\S+@\S+/.test(data.email) == false) {
                res.status(400);
                res.json({
                    error: 'email not valid'
                });
                return;
            }

            var query = {};

            if (data.username) query.username = data.username;
            query.email = data.email;

            OBJY.client(req.params.client);

            OBJY['users'](query).get(function(udata) {

                    if (udata.length == 0) {
                        res.status(404);
                        res.json({
                            error: 'email not found'
                        });
                        return;
                    } else if (udata.length > 1) {
                        res.status(404);
                        res.json({
                            error: 'use username and email'
                        });
                        return;
                    }

                    metaMapper.createPasswordResetKey(udata[0]._id, req.params.client, function(data) {

                        messageMapper.send((options.userPasswordResetMessage || {}).from || 'SPOO', req.body.email, (options.userPasswordResetMessage || {}).subject || 'your password reset key', ((options.userPasswordResetMessage || {}).body || '').replace('__KEY__', data.key) || data.key)

                        res.json({
                            message: 'password reset key sent!'
                        })
                    }, function(err) {
                        res.status(400);
                        res.json({
                            error: err
                        });
                    })

                },
                function(err) {
                    res.status(400);
                    res.json({
                        error: err
                    });
                    return;
                });

        });


    router.route('/client/:client/user/resetpassword')


        .post(function(req, res) {

            var userData = req.body;

            var client = req.params.client || client;

            if (!req.body.resetKey) {
                res.status(400);
                res.json({
                    error: 'No Reset Key found'
                });
                return;
            }

            if (!req.body.password) {
                res.status(400);
                res.json({
                    error: 'Password not provided'
                });
                return;
            }

            if (!req.body.password2) {
                res.status(400);
                res.json({
                    error: 'Password 2 not provided'
                });
                return;
            }

            if (req.body.password != req.body.password2) {
                res.status(400);
                res.json({
                    error: 'Passwords do not match'
                });
                return;
            }

            OBJY.client(req.params.client);

            metaMapper.redeemPasswordResetKey(req.body.resetKey, req.params.client, function(_data) {

                    OBJY.client(req.params.client);

                    OBJY['user'](_data.uId).get(function(data) {

                            data.password = bcrypt.hashSync(req.body.password);

                            data.update(function(spooElem) {
                                    res.json({
                                        message: "Password changed"
                                    });
                                    return;
                                },
                                function(err) {
                                    res.status(400);
                                    res.json({
                                        error: err
                                    });
                                    return;
                                });

                        },
                        function(err) {
                            res.status(400);
                            res.json({
                                error: err
                            });
                            return;
                        });
                },
                function(err) {
                    res.status(400);
                    res.json({
                        error: err
                    });
                    return;
                });
        });

    // ADD: one or many, GET: one or many
    router.route(['/client/:client/register/user', '/client/:client/aapp/:app/register/user'])

        .post(function(req, res) {

            OBJY.client(req.params.client);
            if (req.params.app)
                OBJY.activeApp = req.params.app;

            if (!OBJY['user'])
                res.json({
                    message: "object family does not exist"
                })

            var user = req.body;

            user = CONNECT.serialize(req.body);

            if (!user.username) user.username = shortid.generate();
            if (!user.password) user.password = shortid.generate();
            if (!user.email) user.email = shortid.generate() + "@" + shortid.generate() + ".com";

            user.password = bcrypt.hashSync(user.password);

            if (req.body) {

                OBJY['user'](user).add(function(data) {
                    res.json(CONNECT.deserialize(data))
                }, function(err) {
                    res.json(data)
                })
            }

        })


    // LOGIN
    router.route(['/client/:client/auth', '/client/:client/app/:app/auth'])

        .post(function(req, res) {

            OBJY.client(req.params.client);

            OBJY.useUser(null);

            redis.get('cnt_' + req.body.username, function(err, result) {

                console.log('count result', result);

                if (result !== null) {
                    console.log('r', result, options.maxUserSessions || defaultMaxUserSessions, );
                    if (parseInt(result) >= (options.maxUserSessions || defaultMaxUserSessions)) {
                        res.status(401)
                        res.json({
                            message: 'too many sessions'
                        })
                        return;
                    }
                }

                OBJY.users().auth({
                    username: req.body.username
                }, function(user) {

                    if (bcrypt.compareSync(req.body.password, user.password)) {

                        var clients = user._clients || [];
                        if (clients.indexOf(req.params.client) == -1) clients.push(req.params.client);

                        var _user = JSON.parse(JSON.stringify(user));

                        var tokenId = shortid.generate() + shortid.generate() + shortid.generate();

                        var refreshToken;

                        if (req.body.permanent) refreshToken = 'rt_' + tokenId + 'rt_' + shortid.generate() + shortid.generate() + shortid.generate();

                        var token = jwt.sign({
                            id: _user._id,
                            username: _user.username,
                            privileges: _user.privileges,
                            applications: _user.applications,
                            spooAdmin: _user.spooAdmin,
                            clients: clients,
                            authorisations: _user.authorisations,
                            tokenId: tokenId
                        }, options.jwtSecret || defaultSecret, {
                            expiresIn: 20 * 60000
                        });

                        //redis.set(token, 'true', "EX", 1200)
                        redis.set('at_' + tokenId, token, "EX", 1200)

                        redis.set('cnt_' + req.body.username, ++result, "EX", 1200)

                        if (req.body.permanent) {
                            redis.set('rt_' + tokenId, JSON.stringify(user), "EX", 2592000)
                        }

                        delete user.password;

                        res.json({
                            message: "authenticated",
                            user: CONNECT.deserialize(user),
                            token: {
                                accessToken: token,
                                refreshToken: refreshToken
                            }
                        })

                    } else {
                        res.status(401)
                        res.json({
                            message: "not authenticated"
                        })
                    }
                }, function(err) {
                    res.status(401)
                    res.json({
                        message: "not authenticated"
                    })
                })

            });

        });

    // REFRESH  A TOKEN
    router.route(['/client/:client/token', '/client/:client/app/:app/token'])

        .post(function(req, res) {

            OBJY.client(req.params.client);

            var refreshToken = req.body.refreshToken;
            var oldTokenId = refreshToken.split('rt_')[1];

            redis.get('rt_' + oldTokenId, function(err, result) {
                if (err || !result) return res.status(401).send({
                    auth: false,
                    message: 'Failed to verify refresh token.'
                });

                result = JSON.parse(result);

                var tokenId = shortid.generate() + shortid.generate() + shortid.generate();

                var refreshToken = 'rt_' + tokenId + 'rt_' + shortid.generate() + shortid.generate() + shortid.generate();

                var token = jwt.sign({
                    id: result._id,
                    username: result.username,
                    privileges: result.privileges,
                    clients: result.clients,
                    applications: result.applications,
                    spooAdmin: result.spooAdmin,
                    authorisations: result.authorisations,
                    tokenId: tokenId
                }, options.jwtSecret || defaultSecret, {
                    expiresIn: 20 * 60000
                });

                setTimeout(function() {
                    redis.del('rt_' + oldTokenId);
                    redis.del('at_' + oldTokenId);
                }, 8000)

                //redis.set(token, 'true', "EX", 1200)
                redis.set('at_' + tokenId, token, "EX", 1200)
                redis.set('rt_' + tokenId, JSON.stringify(result), "EX", 2592000)

                delete result.password;

                res.json({
                    message: "authenticated",
                    user: result,
                    token: {
                        accessToken: token,
                        refreshToken: refreshToken
                    }
                })
            });

        });

    // REJECT A TOKEN
    router.route(['/client/:client/token/reject', '/client/:client/app/:app/token/reject'])

        .post(checkAuthentication, function(req, res) {

            OBJY.client(req.params.client);

            jwt.verify(req.body.accessToken, options.jwtSecret || defaultSecret, function(err, decoded) {
                if (err) return res.status(401).send({
                    auth: false,
                    message: 'token is already invalid'
                });

                redis.get('rt_' + decoded.tokenId, function(err, result) {

                    /*if (err || !result) return res.status(404).send({
                        auth: false,
                        message: 'Token not found'
                    });*/

                    redis.del('at_' + decoded.tokenId);
                    redis.del('rt_' + decoded.tokenId);

                    redis.get('cnt_' + decoded.username, function(err, result) {
                        if (result !== null) {
                            if (parseInt(result) > 1)
                                redis.set('cnt_' + decoded.username, --result, "EX", 1200)
                            else redis.del('cnt_' + decoded.username);
                        }
                    })

                    res.json({
                        message: "token rejected"
                    })
                });
            });
        });


    // ADD: one or many, GET: one or many
    router.route(['/client/:client/:entity', '/client/:client/app/:app/:entity'])

        .post(checkAuthentication, checkObjectFamily, function(req, res) {

            OBJY.client(req.params.client);
            if (req.params.app)
                OBJY.activeApp = req.params.app
            else OBJY.activeApp = undefined;

            if (!OBJY[req.params.entity])
                res.json({
                    message: "object family does not exist"
                })

            // add content

            if (req.files) {
                var k = Object.keys(req.files)[0];
                var file = req.files[k];

                function bufferToStream(buffer) {
                    var stream = new Duplex();
                    stream.push(buffer);
                    stream.push(null);
                    return stream;
                }

                var inStream = bufferToStream(file.data);
                inStream.pause();

                if (CONNECT.metaPropPrefix != '') {
                    req.body = {
                        data: inStream,
                        mimetype: file.mimetype
                    }
                } else {
                    req.body = {
                        properties: {
                            data: inStream,
                            mimetype: file.mimetype
                        }
                    }
                }

                req.body.name = file.name;
            }

            if (req.body) {

                req.body = CONNECT.serialize(req.body);

                var pw = req.body.password || shortid.generate() + '.' + shortid.generate();

                if (req.body.username) {
                    req.body.password = bcrypt.hashSync(pw);
                }

                if (Array.isArray(req.body.properties)) propsSerialize(req.body);

                try {
                    OBJY[req.params.entity](req.body).add(function(data) {

                        res.json(CONNECT.deserialize(data))

                        if (req.body.username) {
                            console.log('sending welcome email');
                            messageMapper.send('SPOO', req.body.email, 'your password', pw)
                        }

                    }, function(err) {
                        res.status(400);
                        res.json({
                            error: err
                        })
                    })
                } catch (e) {
                    console.log(e);
                    res.status(400);
                    res.json({
                        error: e
                    })
                }
            }

        })

        .get(checkAuthentication, checkObjectFamily, function(req, res) {

            var filterFieldsEnabled;

            try {
                if (req.query.$filterFieldsEnabled) filterFieldsEnabled = JSON.parse(req.query.$filterFieldsEnabled);
            } catch (e) {}

            OBJY.client(req.params.client);
            if (req.params.app)
                OBJY.activeApp = req.params.app;
            else OBJY.activeApp = undefined;

            if (!OBJY[req.params.entity])
                res.json({
                    message: "object family does not exist"
                })

            if (req.headers.lazyquery) {
                Object.keys(req.query).forEach(function(k) {
                    if (k.indexOf('properties.') != -1 && k.indexOf('.value') == -1) {
                        req.query[k + '.value'] = req.query[k];
                        delete req.query[k];
                    }
                })
            }

            delete req.query.$filterFieldsEnabled;

            var search = CONNECT.serializeQuery(req.query);

            for (var k in search) {
                if (search[k] == 'true') search[k] = true;
                if (search[k] == 'false') search[k] = false;
            }

            console.warn('search', search)

            Object.keys(search).forEach(function(k) {
                if (k == "$query") {
                    console.warn(k, search[k])
                    try {
                        search[k] = JSON.parse(search[k])
                    } catch (e) {

                    }
                }
            })

            delete search.token;

            console.warn('OBJY.activeApp', OBJY.activeApp, req.params.app)

            try {
                OBJY[req.params.entity](search).get(function(data) {

                    var _data = [];
                    data.forEach(function(d) {

                        if ((d.properties || {}).data) {
                            if (isStream(d.properties.data)) {
                                delete d.properties.data;
                                d.properties.path = req.params.entity + '/' + req.params.id + '/stream'
                            }
                        }

                        var d = CONNECT.deserialize(d);
                        if (filterFieldsEnabled) d = CONNECT.filterFields(d, filterFieldsEnabled);

                        if (req.query.$permsAsArr == 'true') propsSerialize
                        _data.push(d)
                    })
                    res.json(_data);

                }, function(err) {
                    res.status(400);
                    res.json({
                        error: err
                    })
                })
            } catch (e) {
                res.status(400);
                res.json({
                    error: e
                })
            }
        });


    // ADD: one or many, GET: one or many
    router.route(['/client/:client/:entity/count', '/client/:client/app/:app/:entity/count'])


        .get(checkAuthentication, checkObjectFamily, function(req, res) {


            OBJY.client(req.params.client);
            if (req.params.app)
                OBJY.activeApp = req.params.app;
            else OBJY.activeApp = undefined;

            if (!OBJY[req.params.entity])
                res.json({
                    message: "object family doe not exist"
                })

            var search = CONNECT.serializeQuery(req.query);

            for (var k in search) {
                if (search[k] == 'true') search[k] = true;
                if (search[k] == 'false') search[k] = false;
            }

            Object.keys(search).forEach(function(k) {
                if (k == "$query") {
                    console.warn(k, search[k])
                    try {
                        search[k] = JSON.parse(search[k])
                    } catch (e) {

                    }
                }
            })

            delete search.token;

            try {

                OBJY[req.params.entity](search).count(function(data) {
                    res.json(data)

                }, function(err) {
                    res.json({
                        error: err
                    })
                })

            } catch (e) {
                res.status(400);
                res.json({ error: e });
            }
        });


    // GET: one, UPDATE: one, DELETE: one
    router.route(['/client/:client/:entity/:id/password', '/client/:client/app/:app/:entity/:id/password'])

        .patch(checkAuthentication, checkObjectFamily, function(req, res) {

            OBJY.client(req.params.client);

            var usrData = req.body;
            var passwordKey = Object.keys(usrData)[0];

            var oldPassword = usrData['old'];
            var newPassword = usrData['new'];

            if (req.user.id != req.params.id) {
                res.status(400);
                res.json({
                    error: 'This operation can only be performed by the user'
                });
                return;
            }

            if (newPassword.length < 3) {
                res.status(400);
                res.json({
                    error: 'Password too short. Use 3 characters or more'
                });
                return;
            }


            if (req.params.app)
                OBJY.activeApp = req.params.app;
            else OBJY.activeApp = undefined;

            if (!OBJY[req.params.entity])
                res.json({
                    message: "object family does not exist"
                })

            try {

                OBJY[req.params.entity](req.params.id).get(function(data) {

                    if (!bcrypt.compareSync(oldPassword, data.password)) {
                        res.status(400);
                        res.json({
                            error: 'Old password not correct'
                        });
                        return;
                    }

                    try {
                        data.setPassword(bcrypt.hashSync(newPassword));
                    } catch (err) {
                        res.status(400);
                        res.json({
                            error: err
                        });
                        return;
                    }

                    data.update(function(_data) {
                        res.json(CONNECT.deserialize(_data))
                    }, function(err) {

                    })

                }, function(err) {
                    res.status(400);
                    res.json({
                        error: err
                    })
                })

            } catch (e) {
                res.status(400);
                res.json({ error: e });
            }

        })



    // GET: one, UPDATE: one, DELETE: one
    router.route(['/client/:client/:entity/:id', '/client/:client/app/:app/:entity/:id'])

        .get(checkAuthentication, checkObjectFamily, function(req, res) {

            var filterFieldsEnabled;

            try {
                if (req.query.$filterFieldsEnabled) filterFieldsEnabled = JSON.parse(req.query.$filterFieldsEnabled);
            } catch (e) {}

            OBJY.client(req.params.client);
            if (req.params.app)
                OBJY.activeApp = req.params.app;
            else OBJY.activeApp = undefined;

            if (!OBJY[req.params.entity]) {
                res.status(400);
                res.json({
                    message: "object family does not exist"
                })
            }


            try {
                OBJY[req.params.entity](req.params.id).get(function(data) {

                    if (data.properties.data) {
                        if (isStream(data.properties.data)) {
                            delete data.properties.data;
                            data.properties.path = req.params.entity + '/' + req.params.id + '/stream'
                        }
                    }

                    data = CONNECT.deserialize(data);
                    if (filterFieldsEnabled) data = CONNECT.filterFields(data, filterFieldsEnabled);



                    res.json(data)
                }, function(err) {
                    res.json({ error: err })
                })
            } catch (e) {
                res.status(400);
                res.json({ error: e });
            }
        })

        .delete(checkAuthentication, checkObjectFamily, function(req, res) {

            OBJY.client(req.params.client);
            if (req.params.app)
                OBJY.activeApp = req.params.app;

            if (!OBJY[req.params.entity])
                res.json({
                    message: "object family does not exist"
                })

            try {

                OBJY[req.params.entity](req.params.id).remove(function(data) {
                    res.json(CONNECT.deserialize(data))
                }, function(err) {
                    res.status(400);
                    res.json({
                        error: err
                    })
                })

            } catch (e) {
                res.status(400);
                res.json({ error: e });
            }

        })

        .patch(checkAuthentication, checkObjectFamily, function(req, res) {

            OBJY.client(req.params.client);


            if (req.params.app)
                OBJY.activeApp = req.params.app;
            else OBJY.activeApp = undefined;

            if (!OBJY[req.params.entity])
                res.json({
                    message: "object family does not exist"
                })

            try {
                OBJY[req.params.entity](req.params.id).get(function(data) {

                    var commands = req.body;

                    data = OBJY[data.role](data);

                    try {


                        if (!Array.isArray(commands)) {
                            var k = Object.keys(commands)[0];
                            console.log('1', k, data[k]);
                            data[k](...commands[k]);
                        } else {

                            commands.forEach(function(c) {
                                var k = Object.keys(c)[0];
                                //console.log(data);
                                console.log('2', k, data[k], Array.isArray(c[k]), c[k]);
                                if (Array.isArray(c[k])) data[k](...c[k]);
                                else data[k](c[k]);
                            })
                        }

                        data.update(function(_data) {
                            res.json(CONNECT.deserialize(_data))
                        }, function(err) {
                            console.log(err);
                            res.status(400);
                            res.json({
                                error: err
                            })
                        })

                    } catch (e) {
                        console.log(e);
                        res.status(400);
                        res.json({
                            error: e
                        })
                    }

                }, function(err) {
                    res.status(400);
                    res.json({
                        error: err
                    })
                })
            } catch (e) {
                res.status(400);
                res.json({ error: e });
            }

        })


        .put(checkAuthentication, checkObjectFamily, function(req, res) {

            OBJY.client(req.params.client);

            if (req.params.app)
                OBJY.activeApp = req.params.app;
            else OBJY.activeApp = undefined;

            if (!OBJY[req.params.entity])
                res.json({
                    message: "object family does not exist"
                })


            OBJY[req.params.entity](req.params.id).get(function(data) {

                data.replace(CONNECT.serialize(req.body));

                try {

                    data.update(function(_data) {
                        res.json(CONNECT.deserialize(_data))
                    }, function(err) {

                    })

                } catch (e) {
                    res.status(400);
                    res.json({ error: e });
                }

            }, function(err) {
                res.status(400);
                res.json({
                    error: "not found"
                })
            })

        });


    router.route(['/client/:client/:entity/:id/stream', '/client/:client/app/:app/:entity/:id/stream'])

        .get(checkAuthentication, checkObjectFamily, function(req, res) {

            OBJY.client(req.params.client);
            if (req.params.app)
                OBJY.app(req.params.app);
            else OBJY.app(undefined);

            if (!OBJY[req.params.entity])
                res.json({
                    message: "object family does not exist"
                })

            try {

                OBJY[req.params.entity](req.params.id).get(function(data) {

                    //res.type(data.mimetype)

                    data.properties.data.resume();
                    data.properties.data.pipe(res);

                }, function(err) {
                    res.json({ error: err })
                })
            } catch (e) {
                res.status(400);
                res.json({ error: e });
            }

        });


    // ADD: one or many, GET: one or many
    router.route(['/client/:client/:entity/:id/property/:propName/call', '/client/:client/app/:app/:entity/:id/property/:propName/call'])

        .post(checkAuthentication, checkObjectFamily, function(req, res) {

            OBJY.client(req.params.client);
            if (req.params.app)
                OBJY.activeApp = req.params.app;
            else OBJY.activeApp = undefined;

            if (!OBJY[req.params.entity])
                res.json({
                    message: "object family does not exist"
                })

            try {
                OBJY[req.params.entity](req.params.id).get(function(data) {

                    if (data.getProperty(req.params.propName)) {
                        data.getProperty(req.params.propName).call(function(data) {

                            res.json({
                                message: "called"
                            })
                        }, req.params.client)
                    }

                }, function(err) {
                    res.status(400);
                    res.json({
                        error: err
                    })
                })
            } catch (e) {
                res.status(400);
                res.json({ error: e });
            }
        });

    this.run = function() {
        app.listen(options.port || '8888');
        app.use('/api', router);
    }

}

process.on('uncaughtException', function(err) {
    console.error(err);
})

module.exports = Platform;