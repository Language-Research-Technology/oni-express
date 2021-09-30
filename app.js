var express = require('express');
var session = require('express-session');
var path = require('path');
var proxy = require('express-http-proxy');
var logger = require('morgan');
var bodyParser = require('body-parser');
var cors = require('cors');
var nocache = require('nocache');
var useragent = require('express-useragent');

var passport = require('passport');
var GitHubStrategy = require('passport-github2').Strategy;

const jwt = require('jwt-simple');

var ocfl = require('./controllers/ocfl');
var check_jwt = require('./controllers/check_jwt');
var auth = require('./controllers/auth');

var MemcachedStore = require("connect-memcached")(session);
var app = express();
var env = app.get('env');

var configFile = process.argv[2] || './config/express.json';
console.log('Using config file: ' + configFile);
var config = require(configFile)[env];

if (config['auth'] && config['auth']['github']) {
  const configAuthGithub = config['auth']['github'];
  passport.use(new GitHubStrategy({
      clientID: configAuthGithub['clientID'],
      clientSecret: configAuthGithub['clientSecret'],
      callbackURL: `${config['baseURL']}${configAuthGithub['callback']}`,
      scope: 'read:org, user'
    },
    function (accessToken, refreshToken, profile, cb) {
      // In this example, the user's profile is supplied as the user record.
      // In a production-quality application, the profile should be associated
      // with a user record in the application's database, which allows for
      // account linking and authentication with other identity providers.
      return cb(null, profile, {accessToken: accessToken, refreshToken: refreshToken});
    }
  ));
}
// Initialize Passport and restore authentication state, if any, from the
// session.
app.use(passport.initialize());
app.use(passport.session());
passport.serializeUser(function (user, done) {
  done(null, user);
});
passport.deserializeUser(function (user, done) {
  done(null, user);
});

const {getVersion, getPortalConfig} = require('./controllers/config');
const indexer = require('./controllers/indexer');
const {verifyToken, simpleVerify} = require('./controllers/local_auth');
const github = require('./services/Github');

const ocfl_path = config.ocfl.url_path || 'ocfl';

app.use(logger('dev'));

app.use(nocache());
app.use(useragent.express());
app.use(express.json());
app.use(express.urlencoded({extended: false}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));
app.set('trust proxy', 1);

app.use(session({
  secret: config.session.secret,
  resave: false,
  saveUninitialized: false,
  proxy: true,
  store: new MemcachedStore({
    hosts: [config.session.server]
  }),
  cookie: {
    maxAge: config.session.expiry * 60 * 60 * 1000
  }

}));

if (config['cors']) {
  app.use(cors());
}

// checkSession: middleware which checks that the user is logged in and has
// values in their session which match what's expected in config.auth.allow.
//
// if the route is /jwt, let it through without checking (because this is the
// return URL from AAF)
// if the route is /, redirect to AAF if there's no session or uid

function checkSession(req, res, next) {
  console.log(`checkSession: ${req.url}`);
  if (config['clientBlock']) {
    const ua = req.useragent;
    for (let cond of config['clientBlock']) {
      if (ua[cond]) {
        console.log(`client blocked ${cond}`);
        res.status(403).send("Browser or client not supported");
        return;
      }
    }
  }
  if (req.session && req.session.uid) {
    //TODO: Here check if you have access to a particular Item
    //if you do serve item
    //else return res.status(403).json({error: {message: 'Forbidden'}});
    next();
  } else {
    next();
  }
}

app.use(checkSession);
// authentication endpoint
app.get('/auth/logout', function (req, res) {
  req.session.destroy(function (err) {
    res.redirect('/');
  });
});

app.get('/auth/github', passport.authenticate('github', {}, function (req, res) {
  console.log('/auth/github');
}));

app.get('/auth/github/callback', function (req, res, next) {
  passport.authenticate('github', function (err, user, info) {
    if (err) {
      return next(err);
    }
    if (!user) {
      return res.redirect('/auth/github');
    }
    req.logIn(user, async function (err) {
      if (err) {
        return next(err);
      }
      req.session.accessToken = info.accessToken;
      req.session.uid = user['id'];
      req.session.displayName = user['displayName'];
      req.session.username = user['username'];
      req.session.provider = user['provider'];
      req.session.memberships = await auth.setUserAccess({
        config: config,
        user: {username: req.session.username, accessToken: req.session.accessToken}
      })
      //TODO: how to return the user to where it was?
      return res.redirect('/');
    });
  })(req, res, next);
});

app.post('/jwt', (req, res) => {

  const authjwt = jwt.decode(req.body['assertion'], config.auth.jwtSecret);
  if (check_jwt(config.auth, authjwt)) {
    console.log("AAF authentication was successful");
    const atts = authjwt[config.auth.attributes];
    req.session.uid = atts['mail'];
    req.session.displayName = atts['displayname'];
    req.session.affiliation = atts['edupersonscopedaffiliation'];
    res.redirect('/');
  } else {
    console.log("AAF authentication failed");
    res.sendStatus(403);
  }
});

app.post("/auth", (req, res) => {
});

app.get('/auth/check', async function (req, res, next) {
  if (req.session.uid) {
    req.session.memberships = await auth.setUserAccess({
      config: config,
      user: {username: req.session.username, accessToken: req.session.accessToken}
    });
    let aPath = req.query['redirect'] || null;
    if (aPath) {
      res.redirect(`/${aPath}`);
    } else {
      res.redirect('/');
    }
  } else {
    next();
  }
});

app.get('/config/portal', async (req, res) => {
  try {
    const portalConfig = await getPortalConfig({indexer: config['indexer'], express: config, base: config['portal']});
    if (req.session.uid) {
      portalConfig['user'] = {
        displayName: req.session.displayName,
        username: req.session.username,
        memberships: req.session.memberships,
        provider: 'github'
      };
    }
    res.status(200).json(portalConfig);
  } catch (e) {
    res.status(500).json({error: e});
  }
});
//Attach to an event listener

app.get('/config/index/run', verifyToken, async (req, res) => {
  try {
    const authorized = await simpleVerify(config.api, req.token);
    if (authorized) {
      await indexer.index({indexer: config['indexer']});
      res.status(200).json({status: 'indexed: commit to solr'});
    } else {
      res.status(403).json({error: 'incorrect token, not authorized'});
    }
  } catch (e) {
    res.status(500).json({error: e});
  }
});

app.get('/config/status', async (req, res) => {
  try {
    let error = false;
    const status = {}
    status.config = {
      express: configFile,
      portal: config.portal,
      indexer: config.indexer,
    }
    status.version = await getVersion();
    const solrStatus = await indexer.solrStatus(config);
    status.solrStatus = solrStatus;
    const solrCheck = await indexer.checkSolr({indexer: config['indexer']}, 1);
    status.solrCheck = solrCheck;
    if (solrCheck.error) {
      status.error = true;
    }
    const ts = new Date();
    status.serverTime = ts.toLocaleString();
    if (error) {
      res.status(500).json(status);
    } else {
      res.status(200).json(status);
    }
  } catch (e) {
    logger.error(e);
    res.status(500).json({error: e});
  }
})
// ocfl-express endpoints

app.get(`/${ocfl_path}/`, async (req, res) => {
  console.log(`/ocfl/ Session id: ${req.session.id}`);
  // if( !req.session.uid ) {
  // 	console.log("/ocfl/repo endpoint: no uid in session");
  //   	res.status(403).send("Forbidden");
  //   	return;
  // }
  if (config.ocfl.autoindex) {
    const index = await ocfl.index(config, req.params.repo, req.query);
    res.send(index);
  } else {
    console.log("Repository indexing is not configured");
    res.status(404).send("Repository index is not configured");
  }
});

// fixme: make cache-control no-store

app.get(`/${ocfl_path}/:oidv/:content*?`, async (req, res) => {
  // console.log(`/ocfl/ Session id: ${req.session.id}`);
  // console.log(`ocfl: session = ${req.session.uid}`);
  // if( !req.session.uid ) {
  // 	console.log("/ocfl/repo/oid: no uid found in session");
  //  	res.status(403).send("Forbidden");
  //   	return;
  // }

  if (config.ocfl.referrer && req.headers['referer'] !== config.ocfl.referrer) {
    console.log(`Request referrer ${req.headers['referer']} does not match ${config.ocfl.referrer}`);
    res.status(403).send("Forbidden");
  } else {
    console.log(`ocfl get: ${JSON.stringify(req.params)}`);
    var content = req.params.content;
    if (req.params[0]) {
      content += req.params[0];
    }
    var oidparts = req.params.oidv.split('.v');
    var oid = oidparts[0];
    var v = (oidparts.length === 2) ? 'v' + oidparts[1] : '';

    console.log(`ocfl get: oid ${oid} v ${v} content ${content}`);

    if (!content || content.slice(-1) === '/') {
      if (config.ocfl.index_file) {
        const index_file = content ? content + config.ocfl.index_file : config.ocfl.index_file;
        const file = await ocfl.file(config, oid, v, index_file);
        if (file) {
          res.sendFile(file);
          return;
        }
        // if the index_file is not found, fall through to autoindex if
        // it's configured
      }
      if (config.ocfl.autoindex) {
        const index = await ocfl.index(config, req.query, oid, v, content);
        if (index) {
          res.send(index);
        } else {
          res.status(404).send("Not found");
        }
      } else {
        console.log("Autoindex not available");
        res.status(404).send("Autoindex is not available");
      }
    } else {
      //TODO: send a proper oid file to the pairtree resolver
      const file = await ocfl.file(config, oid, v, content);
      if (file) {
        res.sendFile(file);
      } else {
        res.status(404).send("Not found");
      }
    }
  }
});

// solr proxy - only allows select queries

app.use('/solr/ocfl/select*', proxy(config['solr'], {
  filter: (req, res) => {

    // if( ! req.session.uid ) {
    // console.log("/solr/ocfl/ No iud found in session");
    // 	return false;
    // }
    return req.method === 'GET';
  },
  proxyReqPathResolver: (req) => {
    if (req.session.uid) {
      const url = auth.authorize({config: config, url: req.originalUrl, session: req.session});
      console.log(url);
      return url;
    } else {
      if (config['solr_fq']) {
        return req.originalUrl + '&fq=' + config['solr_fq']
      } else if (config['solr_fl']) {
        return req.originalUrl + '&fl=' + config['solr_fl'].join(',')
      } else {
        return req.originalUrl;
      }
    }
  }
}));

// data portal front page

app.use('/', express.static(path.join(__dirname, 'portal')));

// Bootstrap Section
(async () => {
  await indexer.buildSchema({indexer: config['indexer']});
})();

module.exports = app;
