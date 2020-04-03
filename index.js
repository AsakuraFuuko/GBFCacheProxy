const http = require('http');
const fs = require('fs');
const url = require('url');
const mkdirp = require('mkdirp');
const zlib = require("zlib");
const HttpProxyAgent = require('http-proxy-agent');

const cache_path = 'cache';
const proxy_url = process.ENV.proxy || '';

const handler = function (req, res, next) {
    console.log(req.url);

    if (req.url.match(/^http:\/\/(game-a3\.granbluefantasy\.jp|gbf\.game-a3\.mbga\.jp)\/assets(_en)?\/\d+\/js[^\/]*\/config\.js$/g)) {
        console.log('handle translate');
        return fs.createReadStream('game-config.js').pipe(res);
    }

    let path = url.parse(req.url).pathname;
    let host = url.parse(req.url).hostname;
    path = cache_path + '/' + host + path;
    mkdirp(require('path').dirname(path));
    new Promise((resolve => fs.exists(path, resolve))).then((exists) => {
        if (exists) {
            if (path.endsWith('/')) {
                return {forced: true}
            }
            console.log('hit: ', path);
            const options = {
                method: 'head',
                headers: req.headers
            };
            if (!!proxy_url) options.agent = new HttpProxyAgent(proxy_url);
            return new Promise(resolve => http.get(req.url, options, resolve)).then(async (proxyRes) => {
                let headers = JSON.parse(fs.readFileSync(path + '.header').toString());
                let local_time = new Date(headers['last-modified']).getTime();
                let remote_time = new Date(proxyRes.headers['last-modified']).getTime();
                let local_size = parseInt(headers['content-length']);
                let remote_size = parseInt(proxyRes.headers['content-length']);
                if (local_time >= remote_time && local_size === remote_size) {
                    headers['content-length'] = fs.statSync(path)['size'];
                    return {body: fs.createReadStream(path), headers, forced: false};
                } else {
                    console.log('update: ', path);
                    return {forced: true}
                }
            })
        } else {
            return {forced: true}
        }
    }).then((args) => {
        if (args.forced) {
            const options = {
                headers: req.headers,
            };
            if (!!proxy_url) options.agent = new HttpProxyAgent(proxy_url);
            return new Promise(resolve => http.get(req.url, options, resolve)).then(async (proxyRes) => {
                console.log(req.url);
                if (proxyRes.headers['content-encoding'] && proxyRes.headers['content-encoding'] === 'gzip') {
                    await proxyRes.pipe(zlib.createGunzip()).pipe(fs.createWriteStream(path))
                } else {
                    await proxyRes.pipe(fs.createWriteStream(path))
                }
                let headers = JSON.parse(JSON.stringify(proxyRes.headers));
                delete headers['content-encoding'];
                fs.writeFileSync(path + '.header', JSON.stringify(headers, ' ', 2));
                console.log('saved: ', path);
                return {body: proxyRes, headers: proxyRes.headers}
            })
        } else {
            return args
        }
    }).then((args) => {
        res.writeHead(200, Object.assign({
            'cache-control': 'no-cache, no-store, must-revalidate',
            'pragma': 'no-cache',
            'expires': 0
        }, args.headers));
        args.body.pipe(res)
    }).catch((err) => {
        console.log(err)
    })
};

const server = http.createServer(handler).listen(2333, function () {
    console.log('Listening on port %d', server.address().port);
});

process.on('uncaughtException', function (err) {
    console.log('Caught exception: ' + err);
});
