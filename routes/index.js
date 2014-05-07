var utils   = require('../lib/utils');
var join    = require('path').join;
var fs      = require('fs');
var path    = require('path');
var request = require('request');
var sizer   = require('easyimage');

var preview_unavailable = 'public/preview-unavailable.png';

module.exports = function(app, useCors) {
  var rasterizerService = app.settings.rasterizerService;
  var fileCleanerService = app.settings.fileCleanerService;

	var options = {};

  // routes
  app.get('/', function(req, res, next) {
    if (!req.param('url', false)) {
      return res.redirect('usage.html');
    }

    var url = utils.url(req.param('url'));
    // required options
    options = {
      uri: 'http://localhost:' + rasterizerService.getPort() + '/',
      headers: { url: url }
    };
    ['width', 'height', 'clipRect', 'javascriptEnabled', 'loadImages', 'localToRemoteUrlAccessEnabled', 'userAgent', 'userName', 'password', 'delay', 'imgSize'].forEach(function(name) {
      if (req.param(name, false)) options.headers[name] = req.param(name);
    });

    var filename = 'screenshot_' + utils.md5(url + JSON.stringify(options)) + '.jpg'; // '.png';
    options.headers.filename = filename;

    var filePath = join(rasterizerService.getPath(), filename);

    var callbackUrl = req.param('callback', false) ? utils.url(req.param('callback')) : false;

    if (fs.existsSync(filePath)) {
      console.log('Request for %s - Found in cache', url);
      processImageUsingCache(filePath, res, callbackUrl, function(err) { if (err) next(err); });
      return;
    }
    console.log('Request for %s - Rasterizing it', url);
    processImageUsingRasterizer(options, filePath, res, callbackUrl, function(err) { if(err) next(err); });
  });

  app.get('*', function(req, res, next) {
    // for backwards compatibility, try redirecting to the main route if the request looks like /www.google.com
    res.redirect('/?url=' + req.url.substring(1));
  });

  // bits of logic
  var processImageUsingCache = function(filePath, res, url, callback) {
    if (url) {
      // asynchronous
      res.send('Will post screenshot to ' + url + ' when processed');
      postImageToUrl(filePath, url, callback);
    } else {
      // synchronous
      sendImageInResponse(filePath, res, callback);
    }
  }

  var processImageUsingRasterizer = function(rasterizerOptions, filePath, res, url, callback) {
    if (url) {
      // asynchronous
      res.send('Will post screenshot to ' + url + ' when processed');
      callRasterizer(rasterizerOptions, function(error) {
        if (error) {
						postImageToUrl(preview_unavailable, url, callback);
				}
        postImageToUrl(filePath, url, callback);
      });
    } else {
      // synchronous
      callRasterizer(rasterizerOptions, function(error) {
        if (error) {
						sendImageInResponse(preview_unavailable, res, callback);
				}
        sendImageInResponse(filePath, res, callback);
      });
    }
  }

  var callRasterizer = function(rasterizerOptions, callback) {
		console.log("Calling: ", rasterizerOptions);
    request.get(rasterizerOptions, function(error, response, body) {
			if (body && body.match(/Error:/)){
				return callback(new Error(body));
			}
      if (error || response.statusCode != 200) {
				var msg = response.statusCode; //= error !== 'undefined' ? error.message : response.statusCode;
				if (typeof error !== 'undefined'){
						console.log('ERR: ', error);
				}
        console.log('Error while requesting the rasterizer: %s', msg);
        rasterizerService.restartService();
        return callback(new Error(body));
      }
      callback(null);
    });
  }

  var postImageToUrl = function(imagePath, url, callback) {
    console.log('Streaming image to %s', url);
    var fileStream = fs.createReadStream(imagePath);
    fileStream.on('end', function() {
      fileCleanerService.addFile(imagePath);
    });
    fileStream.on('error', function(err){
      console.log('Error while reading file: %s', err);
      callback(err);
    });
    fileStream.pipe(request.post(url, function(err) {
      if (err) console.log('Error while streaming screenshot: %s', err);
      callback(err);
    }));
  }

  var sendImageInResponse = function(imagePath, res, callback) {
    console.log('Sending image in response');
    if (useCors) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Expose-Headers", "Content-Type");
    }
		if (!fs.existsSync(imagePath)){
				console.log("File does not exist! ", imagePath);
				return;
		}
    res.sendfile(resizeImage(imagePath, options.headers['imgSize']), function(err) {
      fileCleanerService.addFile(imagePath);
      callback(err);
    });
  }

	var resizeImage = function(imagePath, x){
			if (imagePath.match(preview_unavailable)) {
					return imagePath;
			}
			var thumbnail = path.basename(imagePath, '.jpg') + '_' + x + '.jpg';
			console.log (thumbnail);

			if (fs.existsSync(thumbnail)){
					console.log(thumbnail + " exists.");
					return thumbnail;
			}

			// try using only the width param for now...
			var imgParams = {src:imagePath, dst:thumbnail, width:x};

			sizer.resize(imgParams, function(err, stdout, stderr) {
					if (err) throw err;
					console.log('Resized to width: ' + x);
					return thumbnail;
			});

	}

};
