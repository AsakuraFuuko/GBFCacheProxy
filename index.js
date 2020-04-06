const path = require('path');
const http = require('http');
const net = require('net');
const fs = require('fs');
const url = require('parse-url');
const mkdirp = require('mkdirp');
const zlib = require("zlib");
const HttpProxyAgent = require('http-proxy-agent');

const cache_path = process.env.CACHE_DIR || 'cache';
const proxy_url = process.env.PROXY || '';
const use_translate = process.env.USE_TRANSLATE === 'true';

const whitelist = [
    'game-a.granbluefantasy.jp',
    'game-a1.granbluefantasy.jp',
    'game-a2.granbluefantasy.jp',
    'game-a4.granbluefantasy.jp',
    'game-a5.granbluefantasy.jp',
];

const handler = function (req, res) {
    console.log(req.method, ' ', req.url);

    if (use_translate && req.url.match(/^http:\/\/(game-a3\.granbluefantasy\.jp|gbf\.game-a3\.mbga\.jp)\/assets(_en)?\/\d+\/js[^\/]*\/config\.js$/g)) {
        console.log('handle translate');
        res.writeHead(200, {
            'cache-control': 'no-cache, no-store, must-revalidate',
            pragma: 'no-cache',
            expires: 0,
            'content-type': 'text/javascript;charset=UTF-8',
            // 'content-length': fs.statSync('game-config.js')['size']
        });
        return fs.createReadStream('game-config.js').pipe(res);
    }

    let path1 = url(req.url).pathname;
    let host = url(req.url).resource;
    path1 = cache_path + '/' + host + (path1 === '' ? '/' : path1);
    if (whitelist.includes(host)) {
        mkdirp(path.dirname(path1));
    }
    new Promise((resolve => fs.exists(path1, resolve))).then((exists) => {
        if (exists) {
            if (!whitelist.includes(host) || req.method.toLowerCase() !== 'get' || path1.endsWith('/')) {
                return {forced: true}
            }
            console.log('hit: ', path1);
            const options = {
                method: 'HEAD',
                headers: req.headers
            };
            if (!!proxy_url) options.agent = new HttpProxyAgent(proxy_url);
            return new Promise(resolve => {
                let client = http.request(req.url, options, (proxyRes) => {
                    let headers = JSON.parse(fs.readFileSync(path1 + '.header').toString());
                    let local_time = new Date(headers['last-modified']).getTime();
                    let remote_time = new Date(proxyRes.headers['last-modified']).getTime();
                    let local_size = parseInt(headers['content-length']);
                    let remote_size = parseInt(proxyRes.headers['content-length']);
                    if (proxyRes.statusCode === 304 || local_time >= remote_time && local_size === remote_size) {
                        // headers['content-length'] = fs.statSync(path1)['size'];
                        delete headers['content-encoding'];
                        proxyRes.destroy();
                        resolve({body: fs.createReadStream(path1), headers, forced: false, code: 200})
                    } else {
                        console.log('update: ', path1);
                        proxyRes.destroy();
                        resolve({forced: true})
                    }
                });
                client.end()
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
            if (req.method.toLowerCase() === 'get') {
                return new Promise((resolve) => {
                    http.get(req.url, options, async (proxyRes) => {
                        let headers = JSON.parse(JSON.stringify(proxyRes.headers));
                        if (!(!whitelist.includes(host) || path1.endsWith('/'))) {
                            let stream;
                            if (proxyRes.headers['content-encoding'] && proxyRes.headers['content-encoding'] === 'gzip') {
                                stream = proxyRes.pipe(zlib.createGunzip()).pipe(fs.createWriteStream(path1));
                                delete headers['content-encoding'];
                            } else {
                                stream = proxyRes.pipe(fs.createWriteStream(path1))
                            }
                            stream.on('finish', () => {
                                fs.writeFileSync(path1 + '.header', JSON.stringify(headers, ' ', 2));
                                console.log('saved: ', path1);
                                // headers['content-length'] = fs.statSync(path1)['size'];
                                resolve({body: fs.createReadStream(path1), headers: headers, code: proxyRes.statusCode})
                            })
                        } else {
                            resolve({body: proxyRes, headers: headers, code: proxyRes.statusCode})
                        }
                    });
                })
            } else {
                options.method = req.method;
                return new Promise((resolve) => {
                    let client = http.request(req.url, options, async (proxyRes) => {
                        resolve({body: proxyRes, headers: proxyRes.headers, code: proxyRes.statusCode})
                    });
                    req.pipe(client);
                })
            }
        } else {
            return args
        }
    }).then((args) => {
        let headers = args.headers;
        headers['connection'] = 'close';
        res.writeHead(args.code, headers);
        args.body.pipe(res)
    }).catch((err) => {
        console.log(err)
    })
};

const connect = function (cReq, cSock) {
    console.log(cReq.method, ' ', cReq.url);
    let u = url(cReq.url);
    let pSock = net.connect(u.port, u.resource, function () {
        cSock.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        pSock.pipe(cSock);
        cSock.pipe(pSock);
    }).on('error', function () {
        cSock.end();
    });
};

const server = http.createServer().on("request", handler).on('connect', connect);
server.listen(2333, function () {
    console.log('Listening on port %d', server.address().port);
});

process.on('uncaughtException', function (err) {
    console.log('Caught exception: ' + err);
});
