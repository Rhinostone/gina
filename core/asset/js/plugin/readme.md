# Gina Frontend Framework

Last updated October 16th, 2016

## Dependencies
To be able to compile the GFF (Gina Frontend Framework), you need to install `requirejs` node module.

```tty
$ npm install -g requirejs
```

## Compiling & minification

### Building main frontend framework
Uglify2 is the default compiler.

Locate `/node_modules/gina/core/asset/js/plugin/gina`.
N.B.: replace ${project} by your project path.

```tty
$ cd ${project}/node_modules/gina/core/asset/js/plugin
```

You should see at this point a file named `build.json`.
To compile & minify, run the following command line.

```tty
$ r.js -o build.json
```

### Building loader

```tty
$ cd ${project}/node_modules/gina/core/asset/js/plugin
```

```tty
$ java -jar /usr/local/lib/compiler.jar --compilation_level ADVANCED_OPTIMIZATIONS --js ./src/loader/main.js --create_source_map ./dist/gina.onload.min.js.map --js_output_file ./dist/gina.onload.min.js
```

## Using GFF

You can add to your layout the following tag :
```html
<script type="text/javascript" src="{{ '/js/vendor/gina.min.js' | getUrl() }}"></script>
```

Or you can add to you `/config/views.json` the library path.

GFF will be made available on load through the global variable `gina`.

## Events list

```javascript


```

## Classes list
```javascript


```

### Controller

```javascript


```

### Popin

```javascript


```

## Methods list

### .extend
```javascript


```


## Pacakges list

### engine.io (client)
```javascript
var eio = require('engine.io');
var socket = eio('ws://127.0.0.1:8888');

socket.on('open', function(){
    socket.on('close', function(){
        console.debug('closing socket !')
    });

    socket.on('message', function (payload) {
        console.log(payload);
    })
});
```

### uuid
```javascript
var uuid = require('uuid');
console.log('id -> ', uuid.v4() )
```
Sample output
```tty
id ->  f66f698f-9e17-41f9-a3f2-a25b38d6e379
```
Reference: visite the official [repository](https://github.com/broofa/node-uuid)


