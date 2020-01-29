/** vim: et:ts=4:sw=4:sts=4
 * @license RequireJS 2.3.6 Copyright jQuery Foundation and other contributors.
 * Released under MIT license, https://github.com/requirejs/requirejs/blob/master/LICENSE
 */
//Not using strict: uneven strict support in browsers, #392, and causes
//problems with requirejs.exec()/transpiler plugins that may not be strict.
/*jslint regexp: true, nomen: true, sloppy: true */
/*global window, navigator, document, importScripts, setTimeout, opera */

var requirejs, require, define;
(function (global, setTimeout) {
    var req, s, head, baseElement, dataMain, src,
        interactiveScript, currentlyAddingScript, mainScript, subPath,
        version = '2.3.6',
        commentRegExp = /\/\*[\s\S]*?\*\/|([^:"'=]|^)\/\/.*$/mg,
        cjsRequireRegExp = /[^.]\s*require\s*\(\s*["']([^'"\s]+)["']\s*\)/g,
        jsSuffixRegExp = /\.js$/,
        currDirRegExp = /^\.\//,
        op = Object.prototype,
        ostring = op.toString,
        hasOwn = op.hasOwnProperty,
        isBrowser = !!(typeof window !== 'undefined' && typeof navigator !== 'undefined' && window.document),
        isWebWorker = !isBrowser && typeof importScripts !== 'undefined',
        //PS3 indicates loaded and complete, but need to wait for complete
        //specifically. Sequence is 'loading', 'loaded', execution,
        // then 'complete'. The UA check is unfortunate, but not sure how
        //to feature test w/o causing perf issues.
        readyRegExp = isBrowser && navigator.platform === 'PLAYSTATION 3' ?
                      /^complete$/ : /^(complete|loaded)$/,
        defContextName = '_',
        //Oh the tragedy, detecting opera. See the usage of isOpera for reason.
        isOpera = typeof opera !== 'undefined' && opera.toString() === '[object Opera]',
        contexts = {},
        cfg = {},
        globalDefQueue = [],
        useInteractive = false;

    //Could match something like ')//comment', do not lose the prefix to comment.
    function commentReplace(match, singlePrefix) {
        return singlePrefix || '';
    }

    function isFunction(it) {
        return ostring.call(it) === '[object Function]';
    }

    function isArray(it) {
        return ostring.call(it) === '[object Array]';
    }

    /**
     * Helper function for iterating over an array. If the func returns
     * a true value, it will break out of the loop.
     */
    function each(ary, func) {
        if (ary) {
            var i;
            for (i = 0; i < ary.length; i += 1) {
                if (ary[i] && func(ary[i], i, ary)) {
                    break;
                }
            }
        }
    }

    /**
     * Helper function for iterating over an array backwards. If the func
     * returns a true value, it will break out of the loop.
     */
    function eachReverse(ary, func) {
        if (ary) {
            var i;
            for (i = ary.length - 1; i > -1; i -= 1) {
                if (ary[i] && func(ary[i], i, ary)) {
                    break;
                }
            }
        }
    }

    function hasProp(obj, prop) {
        return hasOwn.call(obj, prop);
    }

    function getOwn(obj, prop) {
        return hasProp(obj, prop) && obj[prop];
    }

    /**
     * Cycles over properties in an object and calls a function for each
     * property value. If the function returns a truthy value, then the
     * iteration is stopped.
     */
    function eachProp(obj, func) {
        var prop;
        for (prop in obj) {
            if (hasProp(obj, prop)) {
                if (func(obj[prop], prop)) {
                    break;
                }
            }
        }
    }

    /**
     * Simple function to mix in properties from source into target,
     * but only if target does not already have a property of the same name.
     */
    function mixin(target, source, force, deepStringMixin) {
        if (source) {
            eachProp(source, function (value, prop) {
                if (force || !hasProp(target, prop)) {
                    if (deepStringMixin && typeof value === 'object' && value &&
                        !isArray(value) && !isFunction(value) &&
                        !(value instanceof RegExp)) {

                        if (!target[prop]) {
                            target[prop] = {};
                        }
                        mixin(target[prop], value, force, deepStringMixin);
                    } else {
                        target[prop] = value;
                    }
                }
            });
        }
        return target;
    }

    //Similar to Function.prototype.bind, but the 'this' object is specified
    //first, since it is easier to read/figure out what 'this' will be.
    function bind(obj, fn) {
        return function () {
            return fn.apply(obj, arguments);
        };
    }

    function scripts() {
        return document.getElementsByTagName('script');
    }

    function defaultOnError(err) {
        throw err;
    }

    //Allow getting a global that is expressed in
    //dot notation, like 'a.b.c'.
    function getGlobal(value) {
        if (!value) {
            return value;
        }
        var g = global;
        each(value.split('.'), function (part) {
            g = g[part];
        });
        return g;
    }

    /**
     * Constructs an error with a pointer to an URL with more information.
     * @param {String} id the error ID that maps to an ID on a web page.
     * @param {String} message human readable error.
     * @param {Error} [err] the original error, if there is one.
     *
     * @returns {Error}
     */
    function makeError(id, msg, err, requireModules) {
        var e = new Error(msg + '\nhttps://requirejs.org/docs/errors.html#' + id);
        e.requireType = id;
        e.requireModules = requireModules;
        if (err) {
            e.originalError = err;
        }
        return e;
    }

    if (typeof define !== 'undefined') {
        //If a define is already in play via another AMD loader,
        //do not overwrite.
        return;
    }

    if (typeof requirejs !== 'undefined') {
        if (isFunction(requirejs)) {
            //Do not overwrite an existing requirejs instance.
            return;
        }
        cfg = requirejs;
        requirejs = undefined;
    }

    //Allow for a require config object
    if (typeof require !== 'undefined' && !isFunction(require)) {
        //assume it is a config object.
        cfg = require;
        require = undefined;
    }

    function newContext(contextName) {
        var inCheckLoaded, Module, context, handlers,
            checkLoadedTimeoutId,
            config = {
                //Defaults. Do not set a default for map
                //config to speed up normalize(), which
                //will run faster if there is no default.
                waitSeconds: 7,
                baseUrl: './',
                paths: {},
                bundles: {},
                pkgs: {},
                shim: {},
                config: {}
            },
            registry = {},
            //registry of just enabled modules, to speed
            //cycle breaking code when lots of modules
            //are registered, but not activated.
            enabledRegistry = {},
            undefEvents = {},
            defQueue = [],
            defined = {},
            urlFetched = {},
            bundlesMap = {},
            requireCounter = 1,
            unnormalizedCounter = 1;

        /**
         * Trims the . and .. from an array of path segments.
         * It will keep a leading path segment if a .. will become
         * the first path segment, to help with module name lookups,
         * which act like paths, but can be remapped. But the end result,
         * all paths that use this function should look normalized.
         * NOTE: this method MODIFIES the input array.
         * @param {Array} ary the array of path segments.
         */
        function trimDots(ary) {
            var i, part;
            for (i = 0; i < ary.length; i++) {
                part = ary[i];
                if (part === '.') {
                    ary.splice(i, 1);
                    i -= 1;
                } else if (part === '..') {
                    // If at the start, or previous value is still ..,
                    // keep them so that when converted to a path it may
                    // still work when converted to a path, even though
                    // as an ID it is less than ideal. In larger point
                    // releases, may be better to just kick out an error.
                    if (i === 0 || (i === 1 && ary[2] === '..') || ary[i - 1] === '..') {
                        continue;
                    } else if (i > 0) {
                        ary.splice(i - 1, 2);
                        i -= 2;
                    }
                }
            }
        }

        /**
         * Given a relative module name, like ./something, normalize it to
         * a real name that can be mapped to a path.
         * @param {String} name the relative name
         * @param {String} baseName a real name that the name arg is relative
         * to.
         * @param {Boolean} applyMap apply the map config to the value. Should
         * only be done if this normalization is for a dependency ID.
         * @returns {String} normalized name
         */
        function normalize(name, baseName, applyMap) {
            var pkgMain, mapValue, nameParts, i, j, nameSegment, lastIndex,
                foundMap, foundI, foundStarMap, starI, normalizedBaseParts,
                baseParts = (baseName && baseName.split('/')),
                map = config.map,
                starMap = map && map['*'];

            //Adjust any relative paths.
            if (name) {
                name = name.split('/');
                lastIndex = name.length - 1;

                // If wanting node ID compatibility, strip .js from end
                // of IDs. Have to do this here, and not in nameToUrl
                // because node allows either .js or non .js to map
                // to same file.
                if (config.nodeIdCompat && jsSuffixRegExp.test(name[lastIndex])) {
                    name[lastIndex] = name[lastIndex].replace(jsSuffixRegExp, '');
                }

                // Starts with a '.' so need the baseName
                if (name[0].charAt(0) === '.' && baseParts) {
                    //Convert baseName to array, and lop off the last part,
                    //so that . matches that 'directory' and not name of the baseName's
                    //module. For instance, baseName of 'one/two/three', maps to
                    //'one/two/three.js', but we want the directory, 'one/two' for
                    //this normalization.
                    normalizedBaseParts = baseParts.slice(0, baseParts.length - 1);
                    name = normalizedBaseParts.concat(name);
                }

                trimDots(name);
                name = name.join('/');
            }

            //Apply map config if available.
            if (applyMap && map && (baseParts || starMap)) {
                nameParts = name.split('/');

                outerLoop: for (i = nameParts.length; i > 0; i -= 1) {
                    nameSegment = nameParts.slice(0, i).join('/');

                    if (baseParts) {
                        //Find the longest baseName segment match in the config.
                        //So, do joins on the biggest to smallest lengths of baseParts.
                        for (j = baseParts.length; j > 0; j -= 1) {
                            mapValue = getOwn(map, baseParts.slice(0, j).join('/'));

                            //baseName segment has config, find if it has one for
                            //this name.
                            if (mapValue) {
                                mapValue = getOwn(mapValue, nameSegment);
                                if (mapValue) {
                                    //Match, update name to the new value.
                                    foundMap = mapValue;
                                    foundI = i;
                                    break outerLoop;
                                }
                            }
                        }
                    }

                    //Check for a star map match, but just hold on to it,
                    //if there is a shorter segment match later in a matching
                    //config, then favor over this star map.
                    if (!foundStarMap && starMap && getOwn(starMap, nameSegment)) {
                        foundStarMap = getOwn(starMap, nameSegment);
                        starI = i;
                    }
                }

                if (!foundMap && foundStarMap) {
                    foundMap = foundStarMap;
                    foundI = starI;
                }

                if (foundMap) {
                    nameParts.splice(0, foundI, foundMap);
                    name = nameParts.join('/');
                }
            }

            // If the name points to a package's name, use
            // the package main instead.
            pkgMain = getOwn(config.pkgs, name);

            return pkgMain ? pkgMain : name;
        }

        function removeScript(name) {
            if (isBrowser) {
                each(scripts(), function (scriptNode) {
                    if (scriptNode.getAttribute('data-requiremodule') === name &&
                            scriptNode.getAttribute('data-requirecontext') === context.contextName) {
                        scriptNode.parentNode.removeChild(scriptNode);
                        return true;
                    }
                });
            }
        }

        function hasPathFallback(id) {
            var pathConfig = getOwn(config.paths, id);
            if (pathConfig && isArray(pathConfig) && pathConfig.length > 1) {
                //Pop off the first array value, since it failed, and
                //retry
                pathConfig.shift();
                context.require.undef(id);

                //Custom require that does not do map translation, since
                //ID is "absolute", already mapped/resolved.
                context.makeRequire(null, {
                    skipMap: true
                })([id]);

                return true;
            }
        }

        //Turns a plugin!resource to [plugin, resource]
        //with the plugin being undefined if the name
        //did not have a plugin prefix.
        function splitPrefix(name) {
            var prefix,
                index = name ? name.indexOf('!') : -1;
            if (index > -1) {
                prefix = name.substring(0, index);
                name = name.substring(index + 1, name.length);
            }
            return [prefix, name];
        }

        /**
         * Creates a module mapping that includes plugin prefix, module
         * name, and path. If parentModuleMap is provided it will
         * also normalize the name via require.normalize()
         *
         * @param {String} name the module name
         * @param {String} [parentModuleMap] parent module map
         * for the module name, used to resolve relative names.
         * @param {Boolean} isNormalized: is the ID already normalized.
         * This is true if this call is done for a define() module ID.
         * @param {Boolean} applyMap: apply the map config to the ID.
         * Should only be true if this map is for a dependency.
         *
         * @returns {Object}
         */
        function makeModuleMap(name, parentModuleMap, isNormalized, applyMap) {
            var url, pluginModule, suffix, nameParts,
                prefix = null,
                parentName = parentModuleMap ? parentModuleMap.name : null,
                originalName = name,
                isDefine = true,
                normalizedName = '';

            //If no name, then it means it is a require call, generate an
            //internal name.
            if (!name) {
                isDefine = false;
                name = '_@r' + (requireCounter += 1);
            }

            nameParts = splitPrefix(name);
            prefix = nameParts[0];
            name = nameParts[1];

            if (prefix) {
                prefix = normalize(prefix, parentName, applyMap);
                pluginModule = getOwn(defined, prefix);
            }

            //Account for relative paths if there is a base name.
            if (name) {
                if (prefix) {
                    if (isNormalized) {
                        normalizedName = name;
                    } else if (pluginModule && pluginModule.normalize) {
                        //Plugin is loaded, use its normalize method.
                        normalizedName = pluginModule.normalize(name, function (name) {
                            return normalize(name, parentName, applyMap);
                        });
                    } else {
                        // If nested plugin references, then do not try to
                        // normalize, as it will not normalize correctly. This
                        // places a restriction on resourceIds, and the longer
                        // term solution is not to normalize until plugins are
                        // loaded and all normalizations to allow for async
                        // loading of a loader plugin. But for now, fixes the
                        // common uses. Details in #1131
                        normalizedName = name.indexOf('!') === -1 ?
                                         normalize(name, parentName, applyMap) :
                                         name;
                    }
                } else {
                    //A regular module.
                    normalizedName = normalize(name, parentName, applyMap);

                    //Normalized name may be a plugin ID due to map config
                    //application in normalize. The map config values must
                    //already be normalized, so do not need to redo that part.
                    nameParts = splitPrefix(normalizedName);
                    prefix = nameParts[0];
                    normalizedName = nameParts[1];
                    isNormalized = true;

                    url = context.nameToUrl(normalizedName);
                }
            }

            //If the id is a plugin id that cannot be determined if it needs
            //normalization, stamp it with a unique ID so two matching relative
            //ids that may conflict can be separate.
            suffix = prefix && !pluginModule && !isNormalized ?
                     '_unnormalized' + (unnormalizedCounter += 1) :
                     '';

            return {
                prefix: prefix,
                name: normalizedName,
                parentMap: parentModuleMap,
                unnormalized: !!suffix,
                url: url,
                originalName: originalName,
                isDefine: isDefine,
                id: (prefix ?
                        prefix + '!' + normalizedName :
                        normalizedName) + suffix
            };
        }

        function getModule(depMap) {
            var id = depMap.id,
                mod = getOwn(registry, id);

            if (!mod) {
                mod = registry[id] = new context.Module(depMap);
            }

            return mod;
        }

        function on(depMap, name, fn) {
            var id = depMap.id,
                mod = getOwn(registry, id);

            if (hasProp(defined, id) &&
                    (!mod || mod.defineEmitComplete)) {
                if (name === 'defined') {
                    fn(defined[id]);
                }
            } else {
                mod = getModule(depMap);
                if (mod.error && name === 'error') {
                    fn(mod.error);
                } else {
                    mod.on(name, fn);
                }
            }
        }

        function onError(err, errback) {
            var ids = err.requireModules,
                notified = false;

            if (errback) {
                errback(err);
            } else {
                each(ids, function (id) {
                    var mod = getOwn(registry, id);
                    if (mod) {
                        //Set error on module, so it skips timeout checks.
                        mod.error = err;
                        if (mod.events.error) {
                            notified = true;
                            mod.emit('error', err);
                        }
                    }
                });

                if (!notified) {
                    req.onError(err);
                }
            }
        }

        /**
         * Internal method to transfer globalQueue items to this context's
         * defQueue.
         */
        function takeGlobalQueue() {
            //Push all the globalDefQueue items into the context's defQueue
            if (globalDefQueue.length) {
                each(globalDefQueue, function(queueItem) {
                    var id = queueItem[0];
                    if (typeof id === 'string') {
                        context.defQueueMap[id] = true;
                    }
                    defQueue.push(queueItem);
                });
                globalDefQueue = [];
            }
        }

        handlers = {
            'require': function (mod) {
                if (mod.require) {
                    return mod.require;
                } else {
                    return (mod.require = context.makeRequire(mod.map));
                }
            },
            'exports': function (mod) {
                mod.usingExports = true;
                if (mod.map.isDefine) {
                    if (mod.exports) {
                        return (defined[mod.map.id] = mod.exports);
                    } else {
                        return (mod.exports = defined[mod.map.id] = {});
                    }
                }
            },
            'module': function (mod) {
                if (mod.module) {
                    return mod.module;
                } else {
                    return (mod.module = {
                        id: mod.map.id,
                        uri: mod.map.url,
                        config: function () {
                            return getOwn(config.config, mod.map.id) || {};
                        },
                        exports: mod.exports || (mod.exports = {})
                    });
                }
            }
        };

        function cleanRegistry(id) {
            //Clean up machinery used for waiting modules.
            delete registry[id];
            delete enabledRegistry[id];
        }

        function breakCycle(mod, traced, processed) {
            var id = mod.map.id;

            if (mod.error) {
                mod.emit('error', mod.error);
            } else {
                traced[id] = true;
                each(mod.depMaps, function (depMap, i) {
                    var depId = depMap.id,
                        dep = getOwn(registry, depId);

                    //Only force things that have not completed
                    //being defined, so still in the registry,
                    //and only if it has not been matched up
                    //in the module already.
                    if (dep && !mod.depMatched[i] && !processed[depId]) {
                        if (getOwn(traced, depId)) {
                            mod.defineDep(i, defined[depId]);
                            mod.check(); //pass false?
                        } else {
                            breakCycle(dep, traced, processed);
                        }
                    }
                });
                processed[id] = true;
            }
        }

        function checkLoaded() {
            var err, usingPathFallback,
                waitInterval = config.waitSeconds * 1000,
                //It is possible to disable the wait interval by using waitSeconds of 0.
                expired = waitInterval && (context.startTime + waitInterval) < new Date().getTime(),
                noLoads = [],
                reqCalls = [],
                stillLoading = false,
                needCycleCheck = true;

            //Do not bother if this call was a result of a cycle break.
            if (inCheckLoaded) {
                return;
            }

            inCheckLoaded = true;

            //Figure out the state of all the modules.
            eachProp(enabledRegistry, function (mod) {
                var map = mod.map,
                    modId = map.id;

                //Skip things that are not enabled or in error state.
                if (!mod.enabled) {
                    return;
                }

                if (!map.isDefine) {
                    reqCalls.push(mod);
                }

                if (!mod.error) {
                    //If the module should be executed, and it has not
                    //been inited and time is up, remember it.
                    if (!mod.inited && expired) {
                        if (hasPathFallback(modId)) {
                            usingPathFallback = true;
                            stillLoading = true;
                        } else {
                            noLoads.push(modId);
                            removeScript(modId);
                        }
                    } else if (!mod.inited && mod.fetched && map.isDefine) {
                        stillLoading = true;
                        if (!map.prefix) {
                            //No reason to keep looking for unfinished
                            //loading. If the only stillLoading is a
                            //plugin resource though, keep going,
                            //because it may be that a plugin resource
                            //is waiting on a non-plugin cycle.
                            return (needCycleCheck = false);
                        }
                    }
                }
            });

            if (expired && noLoads.length) {
                //If wait time expired, throw error of unloaded modules.
                err = makeError('timeout', 'Load timeout for modules: ' + noLoads, null, noLoads);
                err.contextName = context.contextName;
                return onError(err);
            }

            //Not expired, check for a cycle.
            if (needCycleCheck) {
                each(reqCalls, function (mod) {
                    breakCycle(mod, {}, {});
                });
            }

            //If still waiting on loads, and the waiting load is something
            //other than a plugin resource, or there are still outstanding
            //scripts, then just try back later.
            if ((!expired || usingPathFallback) && stillLoading) {
                //Something is still waiting to load. Wait for it, but only
                //if a timeout is not already in effect.
                if ((isBrowser || isWebWorker) && !checkLoadedTimeoutId) {
                    checkLoadedTimeoutId = setTimeout(function () {
                        checkLoadedTimeoutId = 0;
                        checkLoaded();
                    }, 50);
                }
            }

            inCheckLoaded = false;
        }

        Module = function (map) {
            this.events = getOwn(undefEvents, map.id) || {};
            this.map = map;
            this.shim = getOwn(config.shim, map.id);
            this.depExports = [];
            this.depMaps = [];
            this.depMatched = [];
            this.pluginMaps = {};
            this.depCount = 0;

            /* this.exports this.factory
               this.depMaps = [],
               this.enabled, this.fetched
            */
        };

        Module.prototype = {
            init: function (depMaps, factory, errback, options) {
                options = options || {};

                //Do not do more inits if already done. Can happen if there
                //are multiple define calls for the same module. That is not
                //a normal, common case, but it is also not unexpected.
                if (this.inited) {
                    return;
                }

                this.factory = factory;

                if (errback) {
                    //Register for errors on this module.
                    this.on('error', errback);
                } else if (this.events.error) {
                    //If no errback already, but there are error listeners
                    //on this module, set up an errback to pass to the deps.
                    errback = bind(this, function (err) {
                        this.emit('error', err);
                    });
                }

                //Do a copy of the dependency array, so that
                //source inputs are not modified. For example
                //"shim" deps are passed in here directly, and
                //doing a direct modification of the depMaps array
                //would affect that config.
                this.depMaps = depMaps && depMaps.slice(0);

                this.errback = errback;

                //Indicate this module has be initialized
                this.inited = true;

                this.ignore = options.ignore;

                //Could have option to init this module in enabled mode,
                //or could have been previously marked as enabled. However,
                //the dependencies are not known until init is called. So
                //if enabled previously, now trigger dependencies as enabled.
                if (options.enabled || this.enabled) {
                    //Enable this module and dependencies.
                    //Will call this.check()
                    this.enable();
                } else {
                    this.check();
                }
            },

            defineDep: function (i, depExports) {
                //Because of cycles, defined callback for a given
                //export can be called more than once.
                if (!this.depMatched[i]) {
                    this.depMatched[i] = true;
                    this.depCount -= 1;
                    this.depExports[i] = depExports;
                }
            },

            fetch: function () {
                if (this.fetched) {
                    return;
                }
                this.fetched = true;

                context.startTime = (new Date()).getTime();

                var map = this.map;

                //If the manager is for a plugin managed resource,
                //ask the plugin to load it now.
                if (this.shim) {
                    context.makeRequire(this.map, {
                        enableBuildCallback: true
                    })(this.shim.deps || [], bind(this, function () {
                        return map.prefix ? this.callPlugin() : this.load();
                    }));
                } else {
                    //Regular dependency.
                    return map.prefix ? this.callPlugin() : this.load();
                }
            },

            load: function () {
                var url = this.map.url;

                //Regular dependency.
                if (!urlFetched[url]) {
                    urlFetched[url] = true;
                    context.load(this.map.id, url);
                }
            },

            /**
             * Checks if the module is ready to define itself, and if so,
             * define it.
             */
            check: function () {
                if (!this.enabled || this.enabling) {
                    return;
                }

                var err, cjsModule,
                    id = this.map.id,
                    depExports = this.depExports,
                    exports = this.exports,
                    factory = this.factory;

                if (!this.inited) {
                    // Only fetch if not already in the defQueue.
                    if (!hasProp(context.defQueueMap, id)) {
                        this.fetch();
                    }
                } else if (this.error) {
                    this.emit('error', this.error);
                } else if (!this.defining) {
                    //The factory could trigger another require call
                    //that would result in checking this module to
                    //define itself again. If already in the process
                    //of doing that, skip this work.
                    this.defining = true;

                    if (this.depCount < 1 && !this.defined) {
                        if (isFunction(factory)) {
                            //If there is an error listener, favor passing
                            //to that instead of throwing an error. However,
                            //only do it for define()'d  modules. require
                            //errbacks should not be called for failures in
                            //their callbacks (#699). However if a global
                            //onError is set, use that.
                            if ((this.events.error && this.map.isDefine) ||
                                req.onError !== defaultOnError) {
                                try {
                                    exports = context.execCb(id, factory, depExports, exports);
                                } catch (e) {
                                    err = e;
                                }
                            } else {
                                exports = context.execCb(id, factory, depExports, exports);
                            }

                            // Favor return value over exports. If node/cjs in play,
                            // then will not have a return value anyway. Favor
                            // module.exports assignment over exports object.
                            if (this.map.isDefine && exports === undefined) {
                                cjsModule = this.module;
                                if (cjsModule) {
                                    exports = cjsModule.exports;
                                } else if (this.usingExports) {
                                    //exports already set the defined value.
                                    exports = this.exports;
                                }
                            }

                            if (err) {
                                err.requireMap = this.map;
                                err.requireModules = this.map.isDefine ? [this.map.id] : null;
                                err.requireType = this.map.isDefine ? 'define' : 'require';
                                return onError((this.error = err));
                            }

                        } else {
                            //Just a literal value
                            exports = factory;
                        }

                        this.exports = exports;

                        if (this.map.isDefine && !this.ignore) {
                            defined[id] = exports;

                            if (req.onResourceLoad) {
                                var resLoadMaps = [];
                                each(this.depMaps, function (depMap) {
                                    resLoadMaps.push(depMap.normalizedMap || depMap);
                                });
                                req.onResourceLoad(context, this.map, resLoadMaps);
                            }
                        }

                        //Clean up
                        cleanRegistry(id);

                        this.defined = true;
                    }

                    //Finished the define stage. Allow calling check again
                    //to allow define notifications below in the case of a
                    //cycle.
                    this.defining = false;

                    if (this.defined && !this.defineEmitted) {
                        this.defineEmitted = true;
                        this.emit('defined', this.exports);
                        this.defineEmitComplete = true;
                    }

                }
            },

            callPlugin: function () {
                var map = this.map,
                    id = map.id,
                    //Map already normalized the prefix.
                    pluginMap = makeModuleMap(map.prefix);

                //Mark this as a dependency for this plugin, so it
                //can be traced for cycles.
                this.depMaps.push(pluginMap);

                on(pluginMap, 'defined', bind(this, function (plugin) {
                    var load, normalizedMap, normalizedMod,
                        bundleId = getOwn(bundlesMap, this.map.id),
                        name = this.map.name,
                        parentName = this.map.parentMap ? this.map.parentMap.name : null,
                        localRequire = context.makeRequire(map.parentMap, {
                            enableBuildCallback: true
                        });

                    //If current map is not normalized, wait for that
                    //normalized name to load instead of continuing.
                    if (this.map.unnormalized) {
                        //Normalize the ID if the plugin allows it.
                        if (plugin.normalize) {
                            name = plugin.normalize(name, function (name) {
                                return normalize(name, parentName, true);
                            }) || '';
                        }

                        //prefix and name should already be normalized, no need
                        //for applying map config again either.
                        normalizedMap = makeModuleMap(map.prefix + '!' + name,
                                                      this.map.parentMap,
                                                      true);
                        on(normalizedMap,
                            'defined', bind(this, function (value) {
                                this.map.normalizedMap = normalizedMap;
                                this.init([], function () { return value; }, null, {
                                    enabled: true,
                                    ignore: true
                                });
                            }));

                        normalizedMod = getOwn(registry, normalizedMap.id);
                        if (normalizedMod) {
                            //Mark this as a dependency for this plugin, so it
                            //can be traced for cycles.
                            this.depMaps.push(normalizedMap);

                            if (this.events.error) {
                                normalizedMod.on('error', bind(this, function (err) {
                                    this.emit('error', err);
                                }));
                            }
                            normalizedMod.enable();
                        }

                        return;
                    }

                    //If a paths config, then just load that file instead to
                    //resolve the plugin, as it is built into that paths layer.
                    if (bundleId) {
                        this.map.url = context.nameToUrl(bundleId);
                        this.load();
                        return;
                    }

                    load = bind(this, function (value) {
                        this.init([], function () { return value; }, null, {
                            enabled: true
                        });
                    });

                    load.error = bind(this, function (err) {
                        this.inited = true;
                        this.error = err;
                        err.requireModules = [id];

                        //Remove temp unnormalized modules for this module,
                        //since they will never be resolved otherwise now.
                        eachProp(registry, function (mod) {
                            if (mod.map.id.indexOf(id + '_unnormalized') === 0) {
                                cleanRegistry(mod.map.id);
                            }
                        });

                        onError(err);
                    });

                    //Allow plugins to load other code without having to know the
                    //context or how to 'complete' the load.
                    load.fromText = bind(this, function (text, textAlt) {
                        /*jslint evil: true */
                        var moduleName = map.name,
                            moduleMap = makeModuleMap(moduleName),
                            hasInteractive = useInteractive;

                        //As of 2.1.0, support just passing the text, to reinforce
                        //fromText only being called once per resource. Still
                        //support old style of passing moduleName but discard
                        //that moduleName in favor of the internal ref.
                        if (textAlt) {
                            text = textAlt;
                        }

                        //Turn off interactive script matching for IE for any define
                        //calls in the text, then turn it back on at the end.
                        if (hasInteractive) {
                            useInteractive = false;
                        }

                        //Prime the system by creating a module instance for
                        //it.
                        getModule(moduleMap);

                        //Transfer any config to this other module.
                        if (hasProp(config.config, id)) {
                            config.config[moduleName] = config.config[id];
                        }

                        try {
                            req.exec(text);
                        } catch (e) {
                            return onError(makeError('fromtexteval',
                                             'fromText eval for ' + id +
                                            ' failed: ' + e,
                                             e,
                                             [id]));
                        }

                        if (hasInteractive) {
                            useInteractive = true;
                        }

                        //Mark this as a dependency for the plugin
                        //resource
                        this.depMaps.push(moduleMap);

                        //Support anonymous modules.
                        context.completeLoad(moduleName);

                        //Bind the value of that module to the value for this
                        //resource ID.
                        localRequire([moduleName], load);
                    });

                    //Use parentName here since the plugin's name is not reliable,
                    //could be some weird string with no path that actually wants to
                    //reference the parentName's path.
                    plugin.load(map.name, localRequire, load, config);
                }));

                context.enable(pluginMap, this);
                this.pluginMaps[pluginMap.id] = pluginMap;
            },

            enable: function () {
                enabledRegistry[this.map.id] = this;
                this.enabled = true;

                //Set flag mentioning that the module is enabling,
                //so that immediate calls to the defined callbacks
                //for dependencies do not trigger inadvertent load
                //with the depCount still being zero.
                this.enabling = true;

                //Enable each dependency
                each(this.depMaps, bind(this, function (depMap, i) {
                    var id, mod, handler;

                    if (typeof depMap === 'string') {
                        //Dependency needs to be converted to a depMap
                        //and wired up to this module.
                        depMap = makeModuleMap(depMap,
                                               (this.map.isDefine ? this.map : this.map.parentMap),
                                               false,
                                               !this.skipMap);
                        this.depMaps[i] = depMap;

                        handler = getOwn(handlers, depMap.id);

                        if (handler) {
                            this.depExports[i] = handler(this);
                            return;
                        }

                        this.depCount += 1;

                        on(depMap, 'defined', bind(this, function (depExports) {
                            if (this.undefed) {
                                return;
                            }
                            this.defineDep(i, depExports);
                            this.check();
                        }));

                        if (this.errback) {
                            on(depMap, 'error', bind(this, this.errback));
                        } else if (this.events.error) {
                            // No direct errback on this module, but something
                            // else is listening for errors, so be sure to
                            // propagate the error correctly.
                            on(depMap, 'error', bind(this, function(err) {
                                this.emit('error', err);
                            }));
                        }
                    }

                    id = depMap.id;
                    mod = registry[id];

                    //Skip special modules like 'require', 'exports', 'module'
                    //Also, don't call enable if it is already enabled,
                    //important in circular dependency cases.
                    if (!hasProp(handlers, id) && mod && !mod.enabled) {
                        context.enable(depMap, this);
                    }
                }));

                //Enable each plugin that is used in
                //a dependency
                eachProp(this.pluginMaps, bind(this, function (pluginMap) {
                    var mod = getOwn(registry, pluginMap.id);
                    if (mod && !mod.enabled) {
                        context.enable(pluginMap, this);
                    }
                }));

                this.enabling = false;

                this.check();
            },

            on: function (name, cb) {
                var cbs = this.events[name];
                if (!cbs) {
                    cbs = this.events[name] = [];
                }
                cbs.push(cb);
            },

            emit: function (name, evt) {
                each(this.events[name], function (cb) {
                    cb(evt);
                });
                if (name === 'error') {
                    //Now that the error handler was triggered, remove
                    //the listeners, since this broken Module instance
                    //can stay around for a while in the registry.
                    delete this.events[name];
                }
            }
        };

        function callGetModule(args) {
            //Skip modules already defined.
            if (!hasProp(defined, args[0])) {
                getModule(makeModuleMap(args[0], null, true)).init(args[1], args[2]);
            }
        }

        function removeListener(node, func, name, ieName) {
            //Favor detachEvent because of IE9
            //issue, see attachEvent/addEventListener comment elsewhere
            //in this file.
            if (node.detachEvent && !isOpera) {
                //Probably IE. If not it will throw an error, which will be
                //useful to know.
                if (ieName) {
                    node.detachEvent(ieName, func);
                }
            } else {
                node.removeEventListener(name, func, false);
            }
        }

        /**
         * Given an event from a script node, get the requirejs info from it,
         * and then removes the event listeners on the node.
         * @param {Event} evt
         * @returns {Object}
         */
        function getScriptData(evt) {
            //Using currentTarget instead of target for Firefox 2.0's sake. Not
            //all old browsers will be supported, but this one was easy enough
            //to support and still makes sense.
            var node = evt.currentTarget || evt.srcElement;

            //Remove the listeners once here.
            removeListener(node, context.onScriptLoad, 'load', 'onreadystatechange');
            removeListener(node, context.onScriptError, 'error');

            return {
                node: node,
                id: node && node.getAttribute('data-requiremodule')
            };
        }

        function intakeDefines() {
            var args;

            //Any defined modules in the global queue, intake them now.
            takeGlobalQueue();

            //Make sure any remaining defQueue items get properly processed.
            while (defQueue.length) {
                args = defQueue.shift();
                if (args[0] === null) {
                    return onError(makeError('mismatch', 'Mismatched anonymous define() module: ' +
                        args[args.length - 1]));
                } else {
                    //args are id, deps, factory. Should be normalized by the
                    //define() function.
                    callGetModule(args);
                }
            }
            context.defQueueMap = {};
        }

        context = {
            config: config,
            contextName: contextName,
            registry: registry,
            defined: defined,
            urlFetched: urlFetched,
            defQueue: defQueue,
            defQueueMap: {},
            Module: Module,
            makeModuleMap: makeModuleMap,
            nextTick: req.nextTick,
            onError: onError,

            /**
             * Set a configuration for the context.
             * @param {Object} cfg config object to integrate.
             */
            configure: function (cfg) {
                //Make sure the baseUrl ends in a slash.
                if (cfg.baseUrl) {
                    if (cfg.baseUrl.charAt(cfg.baseUrl.length - 1) !== '/') {
                        cfg.baseUrl += '/';
                    }
                }

                // Convert old style urlArgs string to a function.
                if (typeof cfg.urlArgs === 'string') {
                    var urlArgs = cfg.urlArgs;
                    cfg.urlArgs = function(id, url) {
                        return (url.indexOf('?') === -1 ? '?' : '&') + urlArgs;
                    };
                }

                //Save off the paths since they require special processing,
                //they are additive.
                var shim = config.shim,
                    objs = {
                        paths: true,
                        bundles: true,
                        config: true,
                        map: true
                    };

                eachProp(cfg, function (value, prop) {
                    if (objs[prop]) {
                        if (!config[prop]) {
                            config[prop] = {};
                        }
                        mixin(config[prop], value, true, true);
                    } else {
                        config[prop] = value;
                    }
                });

                //Reverse map the bundles
                if (cfg.bundles) {
                    eachProp(cfg.bundles, function (value, prop) {
                        each(value, function (v) {
                            if (v !== prop) {
                                bundlesMap[v] = prop;
                            }
                        });
                    });
                }

                //Merge shim
                if (cfg.shim) {
                    eachProp(cfg.shim, function (value, id) {
                        //Normalize the structure
                        if (isArray(value)) {
                            value = {
                                deps: value
                            };
                        }
                        if ((value.exports || value.init) && !value.exportsFn) {
                            value.exportsFn = context.makeShimExports(value);
                        }
                        shim[id] = value;
                    });
                    config.shim = shim;
                }

                //Adjust packages if necessary.
                if (cfg.packages) {
                    each(cfg.packages, function (pkgObj) {
                        var location, name;

                        pkgObj = typeof pkgObj === 'string' ? {name: pkgObj} : pkgObj;

                        name = pkgObj.name;
                        location = pkgObj.location;
                        if (location) {
                            config.paths[name] = pkgObj.location;
                        }

                        //Save pointer to main module ID for pkg name.
                        //Remove leading dot in main, so main paths are normalized,
                        //and remove any trailing .js, since different package
                        //envs have different conventions: some use a module name,
                        //some use a file name.
                        config.pkgs[name] = pkgObj.name + '/' + (pkgObj.main || 'main')
                                     .replace(currDirRegExp, '')
                                     .replace(jsSuffixRegExp, '');
                    });
                }

                //If there are any "waiting to execute" modules in the registry,
                //update the maps for them, since their info, like URLs to load,
                //may have changed.
                eachProp(registry, function (mod, id) {
                    //If module already has init called, since it is too
                    //late to modify them, and ignore unnormalized ones
                    //since they are transient.
                    if (!mod.inited && !mod.map.unnormalized) {
                        mod.map = makeModuleMap(id, null, true);
                    }
                });

                //If a deps array or a config callback is specified, then call
                //require with those args. This is useful when require is defined as a
                //config object before require.js is loaded.
                if (cfg.deps || cfg.callback) {
                    context.require(cfg.deps || [], cfg.callback);
                }
            },

            makeShimExports: function (value) {
                function fn() {
                    var ret;
                    if (value.init) {
                        ret = value.init.apply(global, arguments);
                    }
                    return ret || (value.exports && getGlobal(value.exports));
                }
                return fn;
            },

            makeRequire: function (relMap, options) {
                options = options || {};

                function localRequire(deps, callback, errback) {
                    var id, map, requireMod;

                    if (options.enableBuildCallback && callback && isFunction(callback)) {
                        callback.__requireJsBuild = true;
                    }

                    if (typeof deps === 'string') {
                        if (isFunction(callback)) {
                            //Invalid call
                            return onError(makeError('requireargs', 'Invalid require call'), errback);
                        }

                        //If require|exports|module are requested, get the
                        //value for them from the special handlers. Caveat:
                        //this only works while module is being defined.
                        if (relMap && hasProp(handlers, deps)) {
                            return handlers[deps](registry[relMap.id]);
                        }

                        //Synchronous access to one module. If require.get is
                        //available (as in the Node adapter), prefer that.
                        if (req.get) {
                            return req.get(context, deps, relMap, localRequire);
                        }

                        //Normalize module name, if it contains . or ..
                        map = makeModuleMap(deps, relMap, false, true);
                        id = map.id;

                        if (!hasProp(defined, id)) {
                            return onError(makeError('notloaded', 'Module name "' +
                                        id +
                                        '" has not been loaded yet for context: ' +
                                        contextName +
                                        (relMap ? '' : '. Use require([])')));
                        }
                        return defined[id];
                    }

                    //Grab defines waiting in the global queue.
                    intakeDefines();

                    //Mark all the dependencies as needing to be loaded.
                    context.nextTick(function () {
                        //Some defines could have been added since the
                        //require call, collect them.
                        intakeDefines();

                        requireMod = getModule(makeModuleMap(null, relMap));

                        //Store if map config should be applied to this require
                        //call for dependencies.
                        requireMod.skipMap = options.skipMap;

                        requireMod.init(deps, callback, errback, {
                            enabled: true
                        });

                        checkLoaded();
                    });

                    return localRequire;
                }

                mixin(localRequire, {
                    isBrowser: isBrowser,

                    /**
                     * Converts a module name + .extension into an URL path.
                     * *Requires* the use of a module name. It does not support using
                     * plain URLs like nameToUrl.
                     */
                    toUrl: function (moduleNamePlusExt) {
                        var ext,
                            index = moduleNamePlusExt.lastIndexOf('.'),
                            segment = moduleNamePlusExt.split('/')[0],
                            isRelative = segment === '.' || segment === '..';

                        //Have a file extension alias, and it is not the
                        //dots from a relative path.
                        if (index !== -1 && (!isRelative || index > 1)) {
                            ext = moduleNamePlusExt.substring(index, moduleNamePlusExt.length);
                            moduleNamePlusExt = moduleNamePlusExt.substring(0, index);
                        }

                        return context.nameToUrl(normalize(moduleNamePlusExt,
                                                relMap && relMap.id, true), ext,  true);
                    },

                    defined: function (id) {
                        return hasProp(defined, makeModuleMap(id, relMap, false, true).id);
                    },

                    specified: function (id) {
                        id = makeModuleMap(id, relMap, false, true).id;
                        return hasProp(defined, id) || hasProp(registry, id);
                    }
                });

                //Only allow undef on top level require calls
                if (!relMap) {
                    localRequire.undef = function (id) {
                        //Bind any waiting define() calls to this context,
                        //fix for #408
                        takeGlobalQueue();

                        var map = makeModuleMap(id, relMap, true),
                            mod = getOwn(registry, id);

                        mod.undefed = true;
                        removeScript(id);

                        delete defined[id];
                        delete urlFetched[map.url];
                        delete undefEvents[id];

                        //Clean queued defines too. Go backwards
                        //in array so that the splices do not
                        //mess up the iteration.
                        eachReverse(defQueue, function(args, i) {
                            if (args[0] === id) {
                                defQueue.splice(i, 1);
                            }
                        });
                        delete context.defQueueMap[id];

                        if (mod) {
                            //Hold on to listeners in case the
                            //module will be attempted to be reloaded
                            //using a different config.
                            if (mod.events.defined) {
                                undefEvents[id] = mod.events;
                            }

                            cleanRegistry(id);
                        }
                    };
                }

                return localRequire;
            },

            /**
             * Called to enable a module if it is still in the registry
             * awaiting enablement. A second arg, parent, the parent module,
             * is passed in for context, when this method is overridden by
             * the optimizer. Not shown here to keep code compact.
             */
            enable: function (depMap) {
                var mod = getOwn(registry, depMap.id);
                if (mod) {
                    getModule(depMap).enable();
                }
            },

            /**
             * Internal method used by environment adapters to complete a load event.
             * A load event could be a script load or just a load pass from a synchronous
             * load call.
             * @param {String} moduleName the name of the module to potentially complete.
             */
            completeLoad: function (moduleName) {
                var found, args, mod,
                    shim = getOwn(config.shim, moduleName) || {},
                    shExports = shim.exports;

                takeGlobalQueue();

                while (defQueue.length) {
                    args = defQueue.shift();
                    if (args[0] === null) {
                        args[0] = moduleName;
                        //If already found an anonymous module and bound it
                        //to this name, then this is some other anon module
                        //waiting for its completeLoad to fire.
                        if (found) {
                            break;
                        }
                        found = true;
                    } else if (args[0] === moduleName) {
                        //Found matching define call for this script!
                        found = true;
                    }

                    callGetModule(args);
                }
                context.defQueueMap = {};

                //Do this after the cycle of callGetModule in case the result
                //of those calls/init calls changes the registry.
                mod = getOwn(registry, moduleName);

                if (!found && !hasProp(defined, moduleName) && mod && !mod.inited) {
                    if (config.enforceDefine && (!shExports || !getGlobal(shExports))) {
                        if (hasPathFallback(moduleName)) {
                            return;
                        } else {
                            return onError(makeError('nodefine',
                                             'No define call for ' + moduleName,
                                             null,
                                             [moduleName]));
                        }
                    } else {
                        //A script that does not call define(), so just simulate
                        //the call for it.
                        callGetModule([moduleName, (shim.deps || []), shim.exportsFn]);
                    }
                }

                checkLoaded();
            },

            /**
             * Converts a module name to a file path. Supports cases where
             * moduleName may actually be just an URL.
             * Note that it **does not** call normalize on the moduleName,
             * it is assumed to have already been normalized. This is an
             * internal API, not a public one. Use toUrl for the public API.
             */
            nameToUrl: function (moduleName, ext, skipExt) {
                var paths, syms, i, parentModule, url,
                    parentPath, bundleId,
                    pkgMain = getOwn(config.pkgs, moduleName);

                if (pkgMain) {
                    moduleName = pkgMain;
                }

                bundleId = getOwn(bundlesMap, moduleName);

                if (bundleId) {
                    return context.nameToUrl(bundleId, ext, skipExt);
                }

                //If a colon is in the URL, it indicates a protocol is used and it is just
                //an URL to a file, or if it starts with a slash, contains a query arg (i.e. ?)
                //or ends with .js, then assume the user meant to use an url and not a module id.
                //The slash is important for protocol-less URLs as well as full paths.
                if (req.jsExtRegExp.test(moduleName)) {
                    //Just a plain path, not module name lookup, so just return it.
                    //Add extension if it is included. This is a bit wonky, only non-.js things pass
                    //an extension, this method probably needs to be reworked.
                    url = moduleName + (ext || '');
                } else {
                    //A module that needs to be converted to a path.
                    paths = config.paths;

                    syms = moduleName.split('/');
                    //For each module name segment, see if there is a path
                    //registered for it. Start with most specific name
                    //and work up from it.
                    for (i = syms.length; i > 0; i -= 1) {
                        parentModule = syms.slice(0, i).join('/');

                        parentPath = getOwn(paths, parentModule);
                        if (parentPath) {
                            //If an array, it means there are a few choices,
                            //Choose the one that is desired
                            if (isArray(parentPath)) {
                                parentPath = parentPath[0];
                            }
                            syms.splice(0, i, parentPath);
                            break;
                        }
                    }

                    //Join the path parts together, then figure out if baseUrl is needed.
                    url = syms.join('/');
                    url += (ext || (/^data\:|^blob\:|\?/.test(url) || skipExt ? '' : '.js'));
                    url = (url.charAt(0) === '/' || url.match(/^[\w\+\.\-]+:/) ? '' : config.baseUrl) + url;
                }

                return config.urlArgs && !/^blob\:/.test(url) ?
                       url + config.urlArgs(moduleName, url) : url;
            },

            //Delegates to req.load. Broken out as a separate function to
            //allow overriding in the optimizer.
            load: function (id, url) {
                req.load(context, id, url);
            },

            /**
             * Executes a module callback function. Broken out as a separate function
             * solely to allow the build system to sequence the files in the built
             * layer in the right sequence.
             *
             * @private
             */
            execCb: function (name, callback, args, exports) {
                return callback.apply(exports, args);
            },

            /**
             * callback for script loads, used to check status of loading.
             *
             * @param {Event} evt the event from the browser for the script
             * that was loaded.
             */
            onScriptLoad: function (evt) {
                //Using currentTarget instead of target for Firefox 2.0's sake. Not
                //all old browsers will be supported, but this one was easy enough
                //to support and still makes sense.
                if (evt.type === 'load' ||
                        (readyRegExp.test((evt.currentTarget || evt.srcElement).readyState))) {
                    //Reset interactive script so a script node is not held onto for
                    //to long.
                    interactiveScript = null;

                    //Pull out the name of the module and the context.
                    var data = getScriptData(evt);
                    context.completeLoad(data.id);
                }
            },

            /**
             * Callback for script errors.
             */
            onScriptError: function (evt) {
                var data = getScriptData(evt);
                if (!hasPathFallback(data.id)) {
                    var parents = [];
                    eachProp(registry, function(value, key) {
                        if (key.indexOf('_@r') !== 0) {
                            each(value.depMaps, function(depMap) {
                                if (depMap.id === data.id) {
                                    parents.push(key);
                                    return true;
                                }
                            });
                        }
                    });
                    return onError(makeError('scripterror', 'Script error for "' + data.id +
                                             (parents.length ?
                                             '", needed by: ' + parents.join(', ') :
                                             '"'), evt, [data.id]));
                }
            }
        };

        context.require = context.makeRequire();
        return context;
    }

    /**
     * Main entry point.
     *
     * If the only argument to require is a string, then the module that
     * is represented by that string is fetched for the appropriate context.
     *
     * If the first argument is an array, then it will be treated as an array
     * of dependency string names to fetch. An optional function callback can
     * be specified to execute when all of those dependencies are available.
     *
     * Make a local req variable to help Caja compliance (it assumes things
     * on a require that are not standardized), and to give a short
     * name for minification/local scope use.
     */
    req = requirejs = function (deps, callback, errback, optional) {

        //Find the right context, use default
        var context, config,
            contextName = defContextName;

        // Determine if have config object in the call.
        if (!isArray(deps) && typeof deps !== 'string') {
            // deps is a config object
            config = deps;
            if (isArray(callback)) {
                // Adjust args if there are dependencies
                deps = callback;
                callback = errback;
                errback = optional;
            } else {
                deps = [];
            }
        }

        if (config && config.context) {
            contextName = config.context;
        }

        context = getOwn(contexts, contextName);
        if (!context) {
            context = contexts[contextName] = req.s.newContext(contextName);
        }

        if (config) {
            context.configure(config);
        }

        return context.require(deps, callback, errback);
    };

    /**
     * Support require.config() to make it easier to cooperate with other
     * AMD loaders on globally agreed names.
     */
    req.config = function (config) {
        return req(config);
    };

    /**
     * Execute something after the current tick
     * of the event loop. Override for other envs
     * that have a better solution than setTimeout.
     * @param  {Function} fn function to execute later.
     */
    req.nextTick = typeof setTimeout !== 'undefined' ? function (fn) {
        setTimeout(fn, 4);
    } : function (fn) { fn(); };

    /**
     * Export require as a global, but only if it does not already exist.
     */
    if (!require) {
        require = req;
    }

    req.version = version;

    //Used to filter out dependencies that are already paths.
    req.jsExtRegExp = /^\/|:|\?|\.js$/;
    req.isBrowser = isBrowser;
    s = req.s = {
        contexts: contexts,
        newContext: newContext
    };

    //Create default context.
    req({});

    //Exports some context-sensitive methods on global require.
    each([
        'toUrl',
        'undef',
        'defined',
        'specified'
    ], function (prop) {
        //Reference from contexts instead of early binding to default context,
        //so that during builds, the latest instance of the default context
        //with its config gets used.
        req[prop] = function () {
            var ctx = contexts[defContextName];
            return ctx.require[prop].apply(ctx, arguments);
        };
    });

    if (isBrowser) {
        head = s.head = document.getElementsByTagName('head')[0];
        //If BASE tag is in play, using appendChild is a problem for IE6.
        //When that browser dies, this can be removed. Details in this jQuery bug:
        //http://dev.jquery.com/ticket/2709
        baseElement = document.getElementsByTagName('base')[0];
        if (baseElement) {
            head = s.head = baseElement.parentNode;
        }
    }

    /**
     * Any errors that require explicitly generates will be passed to this
     * function. Intercept/override it if you want custom error handling.
     * @param {Error} err the error object.
     */
    req.onError = defaultOnError;

    /**
     * Creates the node for the load command. Only used in browser envs.
     */
    req.createNode = function (config, moduleName, url) {
        var node = config.xhtml ?
                document.createElementNS('http://www.w3.org/1999/xhtml', 'html:script') :
                document.createElement('script');
        node.type = config.scriptType || 'text/javascript';
        node.charset = 'utf-8';
        node.async = true;
        return node;
    };

    /**
     * Does the request to load a module for the browser case.
     * Make this a separate function to allow other environments
     * to override it.
     *
     * @param {Object} context the require context to find state.
     * @param {String} moduleName the name of the module.
     * @param {Object} url the URL to the module.
     */
    req.load = function (context, moduleName, url) {
        var config = (context && context.config) || {},
            node;
        if (isBrowser) {
            //In the browser so use a script tag
            node = req.createNode(config, moduleName, url);

            node.setAttribute('data-requirecontext', context.contextName);
            node.setAttribute('data-requiremodule', moduleName);

            //Set up load listener. Test attachEvent first because IE9 has
            //a subtle issue in its addEventListener and script onload firings
            //that do not match the behavior of all other browsers with
            //addEventListener support, which fire the onload event for a
            //script right after the script execution. See:
            //https://connect.microsoft.com/IE/feedback/details/648057/script-onload-event-is-not-fired-immediately-after-script-execution
            //UNFORTUNATELY Opera implements attachEvent but does not follow the script
            //script execution mode.
            if (node.attachEvent &&
                    //Check if node.attachEvent is artificially added by custom script or
                    //natively supported by browser
                    //read https://github.com/requirejs/requirejs/issues/187
                    //if we can NOT find [native code] then it must NOT natively supported.
                    //in IE8, node.attachEvent does not have toString()
                    //Note the test for "[native code" with no closing brace, see:
                    //https://github.com/requirejs/requirejs/issues/273
                    !(node.attachEvent.toString && node.attachEvent.toString().indexOf('[native code') < 0) &&
                    !isOpera) {
                //Probably IE. IE (at least 6-8) do not fire
                //script onload right after executing the script, so
                //we cannot tie the anonymous define call to a name.
                //However, IE reports the script as being in 'interactive'
                //readyState at the time of the define call.
                useInteractive = true;

                node.attachEvent('onreadystatechange', context.onScriptLoad);
                //It would be great to add an error handler here to catch
                //404s in IE9+. However, onreadystatechange will fire before
                //the error handler, so that does not help. If addEventListener
                //is used, then IE will fire error before load, but we cannot
                //use that pathway given the connect.microsoft.com issue
                //mentioned above about not doing the 'script execute,
                //then fire the script load event listener before execute
                //next script' that other browsers do.
                //Best hope: IE10 fixes the issues,
                //and then destroys all installs of IE 6-9.
                //node.attachEvent('onerror', context.onScriptError);
            } else {
                node.addEventListener('load', context.onScriptLoad, false);
                node.addEventListener('error', context.onScriptError, false);
            }
            node.src = url;

            //Calling onNodeCreated after all properties on the node have been
            //set, but before it is placed in the DOM.
            if (config.onNodeCreated) {
                config.onNodeCreated(node, config, moduleName, url);
            }

            //For some cache cases in IE 6-8, the script executes before the end
            //of the appendChild execution, so to tie an anonymous define
            //call to the module name (which is stored on the node), hold on
            //to a reference to this node, but clear after the DOM insertion.
            currentlyAddingScript = node;
            if (baseElement) {
                head.insertBefore(node, baseElement);
            } else {
                head.appendChild(node);
            }
            currentlyAddingScript = null;

            return node;
        } else if (isWebWorker) {
            try {
                //In a web worker, use importScripts. This is not a very
                //efficient use of importScripts, importScripts will block until
                //its script is downloaded and evaluated. However, if web workers
                //are in play, the expectation is that a build has been done so
                //that only one script needs to be loaded anyway. This may need
                //to be reevaluated if other use cases become common.

                // Post a task to the event loop to work around a bug in WebKit
                // where the worker gets garbage-collected after calling
                // importScripts(): https://webkit.org/b/153317
                setTimeout(function() {}, 0);
                importScripts(url);

                //Account for anonymous modules
                context.completeLoad(moduleName);
            } catch (e) {
                context.onError(makeError('importscripts',
                                'importScripts failed for ' +
                                    moduleName + ' at ' + url,
                                e,
                                [moduleName]));
            }
        }
    };

    function getInteractiveScript() {
        if (interactiveScript && interactiveScript.readyState === 'interactive') {
            return interactiveScript;
        }

        eachReverse(scripts(), function (script) {
            if (script.readyState === 'interactive') {
                return (interactiveScript = script);
            }
        });
        return interactiveScript;
    }

    //Look for a data-main script attribute, which could also adjust the baseUrl.
    if (isBrowser && !cfg.skipDataMain) {
        //Figure out baseUrl. Get it from the script tag with require.js in it.
        eachReverse(scripts(), function (script) {
            //Set the 'head' where we can append children by
            //using the script's parent.
            if (!head) {
                head = script.parentNode;
            }

            //Look for a data-main attribute to set main script for the page
            //to load. If it is there, the path to data main becomes the
            //baseUrl, if it is not already set.
            dataMain = script.getAttribute('data-main');
            if (dataMain) {
                //Preserve dataMain in case it is a path (i.e. contains '?')
                mainScript = dataMain;

                //Set final baseUrl if there is not already an explicit one,
                //but only do so if the data-main value is not a loader plugin
                //module ID.
                if (!cfg.baseUrl && mainScript.indexOf('!') === -1) {
                    //Pull off the directory of data-main for use as the
                    //baseUrl.
                    src = mainScript.split('/');
                    mainScript = src.pop();
                    subPath = src.length ? src.join('/')  + '/' : './';

                    cfg.baseUrl = subPath;
                }

                //Strip off any trailing .js since mainScript is now
                //like a module name.
                mainScript = mainScript.replace(jsSuffixRegExp, '');

                //If mainScript is still a path, fall back to dataMain
                if (req.jsExtRegExp.test(mainScript)) {
                    mainScript = dataMain;
                }

                //Put the data-main script in the files to load.
                cfg.deps = cfg.deps ? cfg.deps.concat(mainScript) : [mainScript];

                return true;
            }
        });
    }

    /**
     * The function that handles definitions of modules. Differs from
     * require() in that a string for the module should be the first argument,
     * and the function to execute after dependencies are loaded should
     * return a value to define the module corresponding to the first argument's
     * name.
     */
    define = function (name, deps, callback) {
        var node, context;

        //Allow for anonymous modules
        if (typeof name !== 'string') {
            //Adjust args appropriately
            callback = deps;
            deps = name;
            name = null;
        }

        //This module may not have dependencies
        if (!isArray(deps)) {
            callback = deps;
            deps = null;
        }

        //If no name, and callback is a function, then figure out if it a
        //CommonJS thing with dependencies.
        if (!deps && isFunction(callback)) {
            deps = [];
            //Remove comments from the callback string,
            //look for require calls, and pull them into the dependencies,
            //but only if there are function args.
            if (callback.length) {
                callback
                    .toString()
                    .replace(commentRegExp, commentReplace)
                    .replace(cjsRequireRegExp, function (match, dep) {
                        deps.push(dep);
                    });

                //May be a CommonJS thing even without require calls, but still
                //could use exports, and module. Avoid doing exports and module
                //work though if it just needs require.
                //REQUIRES the function to expect the CommonJS variables in the
                //order listed below.
                deps = (callback.length === 1 ? ['require'] : ['require', 'exports', 'module']).concat(deps);
            }
        }

        //If in IE 6-8 and hit an anonymous define() call, do the interactive
        //work.
        if (useInteractive) {
            node = currentlyAddingScript || getInteractiveScript();
            if (node) {
                if (!name) {
                    name = node.getAttribute('data-requiremodule');
                }
                context = contexts[node.getAttribute('data-requirecontext')];
            }
        }

        //Always save off evaluating the def call until the script onload handler.
        //This allows multiple modules to be in a file without prematurely
        //tracing dependencies, and allows for anonymous module support,
        //where the module name is not known until the script onload event
        //occurs. If no context, use the global queue, and get it processed
        //in the onscript load callback.
        if (context) {
            context.defQueue.push([name, deps, callback]);
            context.defQueueMap[name] = true;
        } else {
            globalDefQueue.push([name, deps, callback]);
        }
    };

    define.amd = {
        jQuery: true
    };

    /**
     * Executes the text. Normally just uses eval, but can be modified
     * to use a better, environment-specific call. Only used for transpiling
     * loader plugins, not for plain JS modules.
     * @param {String} text the text to execute/evaluate.
     */
    req.exec = function (text) {
        /*jslint evil: true */
        return eval(text);
    };

    //Set up with config info.
    req(cfg);
}(this, (typeof setTimeout === 'undefined' ? undefined : setTimeout)));

define("requireLib", function(){});

//     uuid.js
//
//     Copyright (c) 2010-2012 Robert Kieffer
//     MIT License - http://opensource.org/licenses/mit-license.php

/*global window, require, define */
(function(_window) {
  'use strict';

  // Unique ID creation requires a high quality random # generator.  We feature
  // detect to determine the best RNG source, normalizing to a function that
  // returns 128-bits of randomness, since that's what's usually required
  var _rng, _mathRNG, _nodeRNG, _whatwgRNG, _previousRoot;

  function setupBrowser() {
    // Allow for MSIE11 msCrypto
    var _crypto = _window.crypto || _window.msCrypto;

    if (!_rng && _crypto && _crypto.getRandomValues) {
      // WHATWG crypto-based RNG - http://wiki.whatwg.org/wiki/Crypto
      //
      // Moderately fast, high quality
      try {
        var _rnds8 = new Uint8Array(16);
        _whatwgRNG = _rng = function whatwgRNG() {
          _crypto.getRandomValues(_rnds8);
          return _rnds8;
        };
        _rng();
      } catch(e) {}
    }

    if (!_rng) {
      // Math.random()-based (RNG)
      //
      // If all else fails, use Math.random().  It's fast, but is of unspecified
      // quality.
      var  _rnds = new Array(16);
      _mathRNG = _rng = function() {
        for (var i = 0, r; i < 16; i++) {
          if ((i & 0x03) === 0) { r = Math.random() * 0x100000000; }
          _rnds[i] = r >>> ((i & 0x03) << 3) & 0xff;
        }

        return _rnds;
      };
      if ('undefined' !== typeof console && console.warn) {
        console.warn("[SECURITY] node-uuid: crypto not usable, falling back to insecure Math.random()");
      }
    }
  }

  function setupNode() {
    // Node.js crypto-based RNG - http://nodejs.org/docs/v0.6.2/api/crypto.html
    //
    // Moderately fast, high quality
    if ('function' === typeof require) {
      try {
        var _rb = require('crypto').randomBytes;
        _nodeRNG = _rng = _rb && function() {return _rb(16);};
        _rng();
      } catch(e) {}
    }
  }

  if (_window) {
    setupBrowser();
  } else {
    setupNode();
  }

  // Buffer class to use
  var BufferClass = ('function' === typeof Buffer) ? Buffer : Array;

  // Maps for number <-> hex string conversion
  var _byteToHex = [];
  var _hexToByte = {};
  for (var i = 0; i < 256; i++) {
    _byteToHex[i] = (i + 0x100).toString(16).substr(1);
    _hexToByte[_byteToHex[i]] = i;
  }

  // **`parse()` - Parse a UUID into it's component bytes**
  function parse(s, buf, offset) {
    var i = (buf && offset) || 0, ii = 0;

    buf = buf || [];
    s.toLowerCase().replace(/[0-9a-f]{2}/g, function(oct) {
      if (ii < 16) { // Don't overflow!
        buf[i + ii++] = _hexToByte[oct];
      }
    });

    // Zero out remaining bytes if string was short
    while (ii < 16) {
      buf[i + ii++] = 0;
    }

    return buf;
  }

  // **`unparse()` - Convert UUID byte array (ala parse()) into a string**
  function unparse(buf, offset) {
    var i = offset || 0, bth = _byteToHex;
    return  bth[buf[i++]] + bth[buf[i++]] +
            bth[buf[i++]] + bth[buf[i++]] + '-' +
            bth[buf[i++]] + bth[buf[i++]] + '-' +
            bth[buf[i++]] + bth[buf[i++]] + '-' +
            bth[buf[i++]] + bth[buf[i++]] + '-' +
            bth[buf[i++]] + bth[buf[i++]] +
            bth[buf[i++]] + bth[buf[i++]] +
            bth[buf[i++]] + bth[buf[i++]];
  }

  // **`v1()` - Generate time-based UUID**
  //
  // Inspired by https://github.com/LiosK/UUID.js
  // and http://docs.python.org/library/uuid.html

  // random #'s we need to init node and clockseq
  var _seedBytes = _rng();

  // Per 4.5, create and 48-bit node id, (47 random bits + multicast bit = 1)
  var _nodeId = [
    _seedBytes[0] | 0x01,
    _seedBytes[1], _seedBytes[2], _seedBytes[3], _seedBytes[4], _seedBytes[5]
  ];

  // Per 4.2.2, randomize (14 bit) clockseq
  var _clockseq = (_seedBytes[6] << 8 | _seedBytes[7]) & 0x3fff;

  // Previous uuid creation time
  var _lastMSecs = 0, _lastNSecs = 0;

  // See https://github.com/broofa/node-uuid for API details
  function v1(options, buf, offset) {
    var i = buf && offset || 0;
    var b = buf || [];

    options = options || {};

    var clockseq = (options.clockseq != null) ? options.clockseq : _clockseq;

    // UUID timestamps are 100 nano-second units since the Gregorian epoch,
    // (1582-10-15 00:00).  JSNumbers aren't precise enough for this, so
    // time is handled internally as 'msecs' (integer milliseconds) and 'nsecs'
    // (100-nanoseconds offset from msecs) since unix epoch, 1970-01-01 00:00.
    var msecs = (options.msecs != null) ? options.msecs : new Date().getTime();

    // Per 4.2.1.2, use count of uuid's generated during the current clock
    // cycle to simulate higher resolution clock
    var nsecs = (options.nsecs != null) ? options.nsecs : _lastNSecs + 1;

    // Time since last uuid creation (in msecs)
    var dt = (msecs - _lastMSecs) + (nsecs - _lastNSecs)/10000;

    // Per 4.2.1.2, Bump clockseq on clock regression
    if (dt < 0 && options.clockseq == null) {
      clockseq = clockseq + 1 & 0x3fff;
    }

    // Reset nsecs if clock regresses (new clockseq) or we've moved onto a new
    // time interval
    if ((dt < 0 || msecs > _lastMSecs) && options.nsecs == null) {
      nsecs = 0;
    }

    // Per 4.2.1.2 Throw error if too many uuids are requested
    if (nsecs >= 10000) {
      throw new Error('uuid.v1(): Can\'t create more than 10M uuids/sec');
    }

    _lastMSecs = msecs;
    _lastNSecs = nsecs;
    _clockseq = clockseq;

    // Per 4.1.4 - Convert from unix epoch to Gregorian epoch
    msecs += 12219292800000;

    // `time_low`
    var tl = ((msecs & 0xfffffff) * 10000 + nsecs) % 0x100000000;
    b[i++] = tl >>> 24 & 0xff;
    b[i++] = tl >>> 16 & 0xff;
    b[i++] = tl >>> 8 & 0xff;
    b[i++] = tl & 0xff;

    // `time_mid`
    var tmh = (msecs / 0x100000000 * 10000) & 0xfffffff;
    b[i++] = tmh >>> 8 & 0xff;
    b[i++] = tmh & 0xff;

    // `time_high_and_version`
    b[i++] = tmh >>> 24 & 0xf | 0x10; // include version
    b[i++] = tmh >>> 16 & 0xff;

    // `clock_seq_hi_and_reserved` (Per 4.2.2 - include variant)
    b[i++] = clockseq >>> 8 | 0x80;

    // `clock_seq_low`
    b[i++] = clockseq & 0xff;

    // `node`
    var node = options.node || _nodeId;
    for (var n = 0; n < 6; n++) {
      b[i + n] = node[n];
    }

    return buf ? buf : unparse(b);
  }

  // **`v4()` - Generate random UUID**

  // See https://github.com/broofa/node-uuid for API details
  function v4(options, buf, offset) {
    // Deprecated - 'format' argument, as supported in v1.2
    var i = buf && offset || 0;

    if (typeof(options) === 'string') {
      buf = (options === 'binary') ? new BufferClass(16) : null;
      options = null;
    }
    options = options || {};

    var rnds = options.random || (options.rng || _rng)();

    // Per 4.4, set bits for version and `clock_seq_hi_and_reserved`
    rnds[6] = (rnds[6] & 0x0f) | 0x40;
    rnds[8] = (rnds[8] & 0x3f) | 0x80;

    // Copy bytes to buffer, if provided
    if (buf) {
      for (var ii = 0; ii < 16; ii++) {
        buf[i + ii] = rnds[ii];
      }
    }

    return buf || unparse(rnds);
  }

  // Export public API
  var uuid = v4;
  uuid.v1 = v1;
  uuid.v4 = v4;
  uuid.parse = parse;
  uuid.unparse = unparse;
  uuid.BufferClass = BufferClass;
  uuid._rng = _rng;
  uuid._mathRNG = _mathRNG;
  uuid._nodeRNG = _nodeRNG;
  uuid._whatwgRNG = _whatwgRNG;

  if (('undefined' !== typeof module) && module.exports) {
    // Publish as node.js module
    module.exports = uuid;
  } else if (typeof define === 'function' && define.amd) {
    // Publish as AMD module
    define('vendor/uuid',[],function() {return uuid;});


  } else {
    // Publish as global (in browsers)
    _previousRoot = _window.uuid;

    // **`noConflict()` - (browser only) to reset global 'uuid' var**
    uuid.noConflict = function() {
      _window.uuid = _previousRoot;
      return uuid;
    };

    _window.uuid = uuid;
  }
})('undefined' !== typeof window ? window : null);

function Merge() {

    var newTarget           = []
        //, keyComparison     = 'id' // use for collections merging [{ id: 'val1' }, { id: 'val2' }, {id: 'val3' }, ...]
    ;
    
    
    /**
     *
     * @param {object} target - Target object
     * @param {object} source - Source object
     * @param {boolean} [override] - Override when copying
     *
     * @return {object} [result]
     * */
    var browse = function (target, source) {
        

        if ( typeof(target) == 'undefined' ) {
            target = ( typeof(source) != 'undefined' && Array.isArray(source)) ? [] : {}
        }

        var override = false;
        if (( typeof(arguments[arguments.length-1]) == 'boolean' )) {
            override = arguments[arguments.length-1]
        }

        var i = 1;
        var length = arguments.length;

        var options, name, src, copy, copyIsArray, clone;



        // Handle case when target is a string or something (possible in deep copy)
        if (typeof(target) !== 'object' && typeof(target) !== 'function') {
            if (override) {
                if (typeof(arguments[2]) == 'undefined') {
                    target = arguments[1]
                } else {
                    target = arguments[2]
                }
            } else {
                if (typeof(arguments[0]) == 'undefined') {
                    target = arguments[1]
                } else {
                    target = arguments[0]
                }
            }

        } else {

            for (; i < length; ++i) {
                // Only deal with non-null/undefined values
                if ( typeof(arguments[i]) != 'boolean' && ( options = arguments[i]) != null) {
                    if ( typeof(options) != 'object') {
                       target = options;
                       break;
                    }

                    // both target & options are arrays
                    if ( Array.isArray(options) && Array.isArray(target) ) {


                        target = mergeArray(options, target, override);

                    } else {
                        // Merge the base object
                        for (var name in options) {
                            if (!target) {
                                target = { name: null }
                            }

                            src     = target[ name ] ;
                            copy    = options[ name ];


                            // Prevent never-ending loop
                            if (target === copy) {
                                continue
                            }

                            // Recurse if we're merging plain objects or arrays
                            if (
                                copy
                                && (
                                    isObject(copy) ||
                                    ( copyIsArray = Array.isArray(copy) )
                                )
                            ) {

                                var createMode = false;
                                if (copyIsArray) {
                                    copyIsArray = false;
                                    clone = src && Array.isArray(src) ? src : [];

                                    newTarget = clone;
                                    clone = mergeArray(copy, clone, override);
                                    target[ name ] = clone;
                                    continue

                                } else {

                                    clone = src && isObject(src) ? src : null;

                                    if (!clone) {
                                        createMode = true;
                                        clone = {};
                                        // copy props
                                        for (var prop in copy) {
                                            clone[prop] = copy[prop]
                                        }
                                    }
                                }



                                //[propose] Supposed to go deep... deep... deep...
                                if ( !override ) {
                                    // add those in copy not in clone (target)

                                    for (var prop in copy) {
                                        if (typeof(clone[ prop ]) == 'undefined') {
                                            if ( Array.isArray(copy[ prop ]) && Array.isArray(clone[ prop ]) ) {
                                                clone[ prop ] = mergeArray(copy[ prop ], clone[ prop ], override);
                                            } else {
                                                clone[ prop ] = copy[ prop ] // don't override existing
                                            }
                                        } else if ( Array.isArray(copy[ prop ]) && Array.isArray(clone[ prop ]) ) {
                                            clone[ prop ] = mergeArray(copy[ prop ], clone[ prop ], override);
                                        }
                                    }




                                    // Never move original objects, clone them
                                    if (typeof(src) != 'boolean' && !createMode ) {//if property is not boolean

                                        // Attention: might lead to a `Maximum call stack size exceeded` Error message
                                        target[ name ] = browse(clone, copy, override);

                                        // this does not work ... target is returned before the end of process.nextTick !!!
                                        // process.nextTick(function onBrowse() {
                                        //     target[name] = browse(clone, copy, override)
                                        // });

                                        // nextTickCalled = true;
                                        // process.nextTick(function onBrowse() {
                                        //     nextTickCalled = false;
                                        //     //target[ name ] = browse(clone, copy, override);
                                        //     return browse(clone, copy, override);
                                        // });


                                    } else if (createMode) {
                                        target[ name ] = clone;
                                    }

                                } else {

                                    for (var prop in copy) {
                                        if ( typeof(copy[ prop ]) != 'undefined' ) {
                                            //clone[prop] = copy[prop]
                                            if ( Array.isArray(copy[ prop ]) && Array.isArray(clone[ prop ]) ) {
                                                clone[ prop ] = mergeArray(copy[ prop ], clone[ prop ], override);
                                            } else {
                                                clone[ prop ] = copy[ prop ] // don't override existing
                                            }
                                        } else if ( Array.isArray(copy[ prop ]) && Array.isArray(clone[ prop ]) ) {
                                            clone[ prop ] = mergeArray(copy[ prop ], clone[ prop ], override);
                                        }
                                    }

                                    target[ name ] = clone
                                }

                            } else if (copy !== undefined) {
                                //[propose]Don't override existing if prop defined or override @ false
                                if (
                                    typeof(src) != 'undefined'
                                    && src != null
                                    && src !== copy && !override
                                ) {
                                    target[ name ] = src
                                } else {
                                    target[ name ] = copy;
                                }

                            }
                        }
                    }
                }

            }

        }

        newTarget = [];
        
        
        
        // return { 
        //     'setKeyComparison' : function(key) {
        //         mergeArray.key = key;
        //         return target;
        //     }
        // } || target
            
        return target;

    }
    
    


    // Will not merge functions items: this is normal
    // Merging arrays is OK, but merging collections is still experimental        
    var mergeArray = function(options, target, override) {
        newTarget = [];
                
        
        var newTargetIds = [], keyComparison = browse.getKeyComparison();

        if (override) {

            // if collection, comparison will be done uppon the `id` attribute by default unless you call .setKeyComparison('someField')
            if (
                typeof(options[0]) == 'object' && typeof(options[0][keyComparison]) != 'undefined'
                && typeof(target[0]) == 'object' && typeof(target[0][keyComparison]) != 'undefined'
            ) {

                newTarget = JSON.parse(JSON.stringify(target));
                
                var _options    = JSON.parse(JSON.stringify(options));
                
                var index = 0;

                for (var n = next || 0, nLen = target.length; n < nLen; ++n) {
                    
                    // if (newTargetIds.indexOf(target[n][keyComparison]) == -1) {
                    //     newTargetIds.push(target[n][keyComparison]);
                        
                    //     //newTarget.push(target[n]);
                    //     //++index;
                    // }
                    
                    label:
                    for (var a = a || 0, aLen = _options.length; a < aLen; ++a) {
                    
                        if (_options[a][keyComparison] === target[n][keyComparison] ) {

                            if (newTargetIds.indexOf(_options[a][keyComparison]) > -1) {
                                
                                newTarget[index] = _options[a];
                                ++index
                                
                            } else if (newTargetIds.indexOf(_options[a][keyComparison]) == -1) {

                                newTargetIds.push(_options[a][keyComparison]);                                
                                newTarget.push(_options[a]);
                            }

                            break label;
                            
                        } else if (newTargetIds.indexOf(_options[a][keyComparison]) == -1) {
                                
                            newTargetIds.push(_options[a][keyComparison]);
                            newTarget.push(_options[a]);
                        }
                    }
                }

                newTargetIds = [];

                return newTarget

            } else { // normal case `arrays` or merging from a blank collection
                return options
            }
        }

        if ( options.length == 0 &&  target.length > 0) {
            newTarget = target;
        }

        if ( target.length == 0 && options.length > 0) {
            for (var a = 0; a < options.length; ++a ) {
                target.push(options[a]);
            }
        }

        if (newTarget.length == 0 && target.length > 0) {            
            // ok, but don't merge objects
            for (var a = 0; a < target.length; ++a ) {
                if ( typeof(target[a]) != 'object' && newTarget.indexOf(target[a]) == -1) {
                    newTarget.push(target[a]);
                }
            }
        }
        
        if ( target.length > 0 ) {
            
            // if collection, comparison will be done uppon the `id` attribute
            if (
                typeof (options[0]) != 'undefined' 
                && typeof (options[0]) == 'object' 
                && options[0] != null 
                && typeof(options[0][keyComparison]) != 'undefined'
                && typeof(target[0]) == 'object' 
                && typeof(target[0][keyComparison]) != 'undefined'
            ) {

                newTarget       = JSON.parse(JSON.stringify(target));
                var _options    = JSON.parse(JSON.stringify(options));
                var next        = null;
                

                for (var a = 0, aLen = newTarget.length; a < aLen; ++a) {
                    newTargetIds.push(newTarget[a][keyComparison]);
                }
                for (var a = 0, aLen = newTarget.length; a < aLen; ++a) {
                    
                    end:
                        for (var n = next || 0, nLen = _options.length; n < nLen; ++n) {
                            
                            if (
                                _options[n] != null && typeof(_options[n][keyComparison]) != 'undefined' && _options[n][keyComparison] !== newTarget[a][keyComparison]

                            ) {
                            
                                if ( newTargetIds.indexOf(_options[n][keyComparison]) == -1 ) {
                                    newTarget.push(_options[n]);
                                    newTargetIds.push(_options[n][keyComparison]);

                                    next = n+1; 

                                    if (aLen < nLen)
                                        ++aLen;

                                    break end; 
                                }
                                                               
                            } else if( _options[n] != null && typeof(_options[n][keyComparison]) != 'undefined' && _options[n][keyComparison] === newTarget[a][keyComparison] ) {

                                next = n+1;

                                //break end;

                            } else {
                                break end;
                            }
                        }


                }

                return newTarget


            } else { // normal case `arrays`
                for (var a = 0; a < options.length; ++a ) {
                    if ( target.indexOf(options[a]) > -1 && override) {
                        target.splice(target.indexOf(options[a]), 1, options[a])
                    } else if ( typeof(newTarget[a]) == 'undefined' && typeof(options[a]) == 'object' ) {
                        // merge using index   
                        newTarget = target;

                        if (typeof (newTarget[a]) == 'undefined')
                            newTarget[a] = {};
                                                    
                            
                        for (var k in options[a]) {
                            if (!newTarget[a].hasOwnProperty(k)) {
                                newTarget[a][k] = options[a][k]
                            }
                        }   
                        
                    } else {
                        // if (newTarget.indexOf(options[a]) == -1)
                        //     newTarget.push(options[a]);
                        
                        if (
                            typeof (target[a]) != 'undefined'
                            && typeof (target[a][keyComparison]) != 'undefined'
                            && typeof (options[a]) != 'undefined'
                            && typeof (options[a][keyComparison]) != 'undefined'
                            && target[a][keyComparison] == options[a][keyComparison]
                        ) {
                            if (override)
                                newTarget[a] = options[a]
                            else
                                newTarget[a] = target[a]
                        } else if (newTarget.indexOf(options[a]) == -1) {
                            newTarget.push(options[a]);
                        }
                        
                        
                    }
                }
            }


        }

        if ( newTarget.length > 0 && target.length > 0 || newTarget.length == 0 && target.length == 0  ) {
            return newTarget
        }
    }
    mergeArray.prototype.setKeyComparison = function(keyComparison) {
        this.keyComparison = keyComparison
    }


    /**
     * Check if object before merging.
     * */
    var isObject = function (obj) {
        if (
            !obj
            || {}.toString.call(obj) !== '[object Object]'
            || obj.nodeType
            || obj.setInterval
        ) {
            return false
        }

        var hasOwn              = {}.hasOwnProperty;
        var hasOwnConstructor   = hasOwn.call(obj, 'constructor');
        // added test for node > v6
        var hasMethodPrototyped = ( typeof(obj.constructor) != 'undefined' ) ? hasOwn.call(obj.constructor.prototype, 'isPrototypeOf') : false;


        if (
            obj.constructor && !hasOwnConstructor && !hasMethodPrototyped
        ) {
            return false
        }

        //Own properties are enumerated firstly, so to speed up,
        //if last one is own, then all properties are own.
        var key;
        return key === undefined || hasOwn.call(obj, key)
    }

    browse.setKeyComparison = function(keyComparison) {
        
        mergeArray.keyComparison = keyComparison;
        
        return browse
    }
    
    browse.getKeyComparison = function() {
        
        var keyComparison = mergeArray.keyComparison || 'id';
        
        // reset for the next merge
        mergeArray.keyComparison = 'id';
        
        return keyComparison
    }
    
    return browse

}

if ( ( typeof(module) !== 'undefined' ) && module.exports ) {
    // Publish as node.js module
    module.exports = Merge()
} else if ( typeof(define) === 'function' && define.amd) {
    // Publish as AMD module
    define( 'utils/merge',[],function() { return Merge() })
};
function registerEvents(plugin, events) {
    gina.registeredEvents[plugin] = events
}

function addListener(target, element, name, callback) {

    if ( typeof(target.event) != 'undefined' && target.event.isTouchSupported && /^(click|mouseout|mouseover)/.test(name) && target.event[name].indexOf(element) == -1) {
        target.event[name][target.event[name].length] = element
    }

    if (typeof(element) != 'undefined' && element != null) {
        if (element.addEventListener) {
            element.addEventListener(name, callback, false)
        } else if (element.attachEvent) {
            element.attachEvent('on' + name, callback)
        }
    } else {
        target.customEvent.addListener(name, callback)
    }

    gina.events[name] = ( typeof(element.id) != 'undefined' && typeof(element.id) != 'object' ) ? element.id : element.getAttribute('id')
}

function triggerEvent (target, element, name, args) {
    if (typeof(element) != 'undefined' && element != null) {
        var evt = null, isDefaultPrevented = false, isAttachedToDOM = false;

        // done separately because it can be listen at the same time by the user & by gina
        if ( jQuery ) { //thru jQuery if detected

            // Check if listener is in use: e.g $('#selector').on('eventName', cb)
            var $events = null; // attached events list
            // Before jQuery 1.7
            var version = jQuery['fn']['jquery'].split(/\./);
            if (version.length > 2) {
                version = version.splice(0,2).join('.');
            } else {
                version = version.join('.');
            }

            if (version <= '1.7') {
                $events = jQuery(element)['data']('events')
            } else {// From 1.8 +
                $events = jQuery['_data'](jQuery(element)[0], "events")
            }

            isAttachedToDOM = ( typeof($events) != 'undefined' && typeof($events[name]) != 'undefined' ) ? true : false;

            if (isAttachedToDOM) { // only trigger if attached
                evt = jQuery.Event( name );
                jQuery(element)['trigger'](evt, args);
                isDefaultPrevented = evt['isDefaultPrevented']();
            }


        }

        if (window.CustomEvent || document.createEvent) {

            if (window.CustomEvent) { // new method from ie9
                evt = new CustomEvent(name, {
                    'detail'    : args,
                    'bubbles'   : true,
                    'cancelable': true,
                    'target'    : element
                })
            } else { // before ie9

                evt = document.createEvent('HTMLEvents');
                // OR
                // evt = document.createEvent('Event');

                evt['detail'] = args;
                evt['target'] = element;
                evt.initEvent(name, true, true);

                evt['eventName'] = name;

            }

            if ( typeof(evt.defaultPrevented) != 'undefined' && evt.defaultPrevented )
                isDefaultPrevented = evt.defaultPrevented;

            if ( !isDefaultPrevented ) {
                //console.log('dispatching ['+name+'] to ', element.id, isAttachedToDOM, evt.detail);
                element.dispatchEvent(evt)
            }

        } else if (document.createEventObject) { // non standard
            evt = document.createEventObject();
            evt.srcElement.id = element.id;
            evt.detail = args;
            evt.target = element;
            element.fireEvent('on' + name, evt)
        }

    } else {
        target.customEvent.fire(name, args)
    }
}

function cancelEvent(event) {
    if (typeof(event) != 'undefined' && event != null) {

        event.cancelBubble = true;

        if (event.preventDefault) {
            event.preventDefault()
        }

        if (event.stopPropagation) {
            event.stopPropagation()
        }


        event.returnValue = false;
    }
}


/**
 * handleXhr
 * 
 * @param {object} xhr - instance
 * @param {object} $el - dom objet element 
 * @param {object} options 
 */    
function handleXhr(xhr, $el, options, require) {
    
    if (!xhr)
        throw new Error('No `xhr` object initiated');
    
    var merge   = require('utils/merge');
    
    var blob            = null
        , isAttachment  = null // handle download
        , contentType   = null
        , result        = null   
        , id            = null
        , $link         = options.$link || null
        , $form         = options.$form || null
        , $target       = null
    ;
    delete options.$link;
    delete options.$form;
    
    if ($form || $link) {
        if ($link) {
            // not the link element but the link elements collection : like for popins main container
            $link.target = document.getElementById($link.id);
            $target     = gina.link.target;
            id          = gina.link.id;
            
            // copy $el attributes to $target
            // for (var prop in $link) {
            //     if ( !$target[prop] )
            //         $target[prop] = $link[prop];
            // }
        } else { // forms
            $target = $form.target;
            id      = $target.getAttribute('id');
        }                
    } else {
        $target = $el;
        id      = $target.getAttribute('id');
    }
    
    // forward callback to HTML data event attribute through `hform` status
    var hLinkIsRequired = ( $link && $el.getAttribute('data-gina-link-event-on-success') || $link && $el.getAttribute('data-gina-link-event-on-error') ) ? true : false;        
    // if (hLinkIsRequired && $link)
    //     listenToXhrEvents($link, 'link');
        
    // forward callback to HTML data event attribute through `hform` status
    var hFormIsRequired = ( $form && $target.getAttribute('data-gina-form-event-on-submit-success') || $form && $target.getAttribute('data-gina-form-event-on-submit-error') ) ? true : false;
    // success -> data-gina-form-event-on-submit-success
    // error -> data-gina-form-event-on-submit-error
    if (hFormIsRequired && $form)
        listenToXhrEvents($form, 'form');
        
    
    // to upload, use `multipart/form-data` for `enctype`
    var enctype = $el.getAttribute('enctype') || options.headers['Content-Type'];
    
    // setting up headers -    all but Content-Type ; it will be set right before .send() is called
    for (var hearder in options.headers) {
        //if ( hearder == 'Content-Type' && typeof (enctype) != 'undefined' && enctype != null && enctype != '') {
        //    options.headers[hearder] = enctype
        //}
        if (hearder == 'Content-Type' && typeof (enctype) != 'undefined' && enctype != null && enctype != '')
            continue;

        xhr.setRequestHeader(hearder, options.headers[hearder]);
    }       
    xhr.withCredentials = ( typeof(options.withCredentials) != 'undefined' ) ? options.withCredentials : false;
    
    
    // catching errors
    xhr.onerror = function(event, err) {
                    
        var error = 'Transaction error: might be due to the server CORS settings.\nPlease, check the console for more details.';
        var result = {
            'status':  xhr.status || 500, //500,
            'error' : error
        };                    
        
        var resultIsObject = true;
        if ($form)
            $form.eventData.error = result;
            
        if ($link)
            $link.eventData.error = result;
                                       
        //updateToolbar(result, resultIsObject);
        window.ginaToolbar.update('data-xhr', result, resultIsObject);
        
        triggerEvent(gina, $target, 'error.' + id, result);
        
        if (hFormIsRequired)
            triggerEvent(gina, $target, 'error.' + id + '.hform', result);
            
        if (hLinkIsRequired)
            triggerEvent(gina, $target, 'error.' + id + '.hlink', result);
    }
    
    // catching ready state cb
    xhr.onreadystatechange = function (event) {
            
        if (xhr.readyState == 2) { // responseType interception
            isAttachment    = ( /^attachment\;/.test( xhr.getResponseHeader('Content-Disposition') ) ) ? true : false; 
            // force blob response type
            if ( !xhr.responseType && isAttachment ) {
                xhr.responseType = 'blob';
            }
        }

        if (xhr.readyState == 4) {
            blob            = null;
            contentType     = xhr.getResponseHeader('Content-Type');     
                
            // 200, 201, 201' etc ...
            if( /^2/.test(xhr.status) ) {

                try {                       
                    
                    // handling blob xhr download
                    if ( /blob/.test(xhr.responseType) || isAttachment ) {
                        if ( typeof(contentType) == 'undefined' || contentType == null) {
                            contentType = 'application/octet-stream';
                        }
                        
                        blob = new Blob([this.response], { type: contentType });
                        
                        //Create a link element, hide it, direct it towards the blob, and then 'click' it programatically
                        var a = document.createElement('a');
                        a.style = 'display: none';
                        document.body.appendChild(a);
                        //Create a DOMString representing the blob and point the link element towards it
                        var url = window.URL.createObjectURL(blob);
                        a.href = url;
                        var contentDisposition = xhr.getResponseHeader('Content-Disposition');
                        a.download = contentDisposition.match('\=(.*)')[0].substr(1);
                        //programatically click the link to trigger the download
                        a.click();
                        //release the reference to the file by revoking the Object URL
                        window.URL.revokeObjectURL(url);
                        
                        result = {
                            status          : xhr.status,
                            statusText      : xhr.statusText,
                            responseType    : blob.type,
                            type            : blob.type,
                            size            : blob.size 
                        }
                        
                    }                        

                    
                    if ( !result && /\/json/.test( contentType ) ) {
                        result = JSON.parse(xhr.responseText);
                        
                        if ( typeof(result.status) == 'undefined' )
                            result.status = xhr.status || 200;
                    }
                    
                    if ( !result && /\/html/.test( contentType ) ) {
                        
                        result = {
                            contentType : contentType,
                            content     : xhr.responseText
                        };
                        
                        if ( typeof(result.status) == 'undefined' )
                            result.status = xhr.status;
                            
                        // if hasPopinHandler & popinIsBinded
                        if ( typeof(gina.popin) != 'undefined' && gina.hasPopinHandler ) {
                            
                            // select popin by id
                            var $popin = gina.popin.getActivePopin();
                            
                            if ($popin) {
                                                
                                XHRData = {};
                                // update toolbar
                                    
                                try {
                                    XHRData = new DOMParser().parseFromString(result.content, 'text/html').getElementById('gina-without-layout-xhr-data');
                                    XHRData = JSON.parse(decodeURIComponent(XHRData.value));
                                    
                                    XHRView = new DOMParser().parseFromString(result.content, 'text/html').getElementById('gina-without-layout-xhr-view');      
                                    XHRView = JSON.parse(decodeURIComponent(XHRView.value));
                                    
                                    // update data tab                                                
                                    if ( gina && typeof(window.ginaToolbar) && typeof(XHRData) != 'undefined' ) {
                                        window.ginaToolbar.update('data-xhr', XHRData);
                                    }
                                    
                                    // update view tab                                        
                                    if ( gina && typeof(window.ginaToolbar) && typeof(XHRView) != 'undefined' ) {
                                        window.ginaToolbar.update('view-xhr', XHRView);
                                    }   

                                } catch (err) {
                                    throw err
                                }                                    
                                
                                $popin.loadContent(result.content);
                                                                        
                                result = XHRData;
                                triggerEvent(gina, $target, 'success.' + id, result);
                                
                                return;
                            }                               
                            
                        }
                    }
                    
                    if (!result) { // normal case
                        result = xhr.responseText;                                
                    }
                    
                    if ($form)
                        $form.eventData.success = result;

                    XHRData = result;
                    // update toolbar
                    if ( gina && typeof(window.ginaToolbar) == 'object' && XHRData ) {
                        try {
                            // don't refresh for html datas
                            if ( typeof(XHRData) != 'undefined' && /\/html/.test(contentType) ) {
                                window.ginaToolbar.update('data-xhr', XHRData);
                            }

                        } catch (err) {
                            throw err
                        }
                    }

                    triggerEvent(gina, $target, 'success.' + id, result);
                    
                    if (hFormIsRequired)
                        triggerEvent(gina, $target, 'success.' + id + '.hform', result);
                        
                    if (hLinkIsRequired)
                        triggerEvent(gina, $target, 'success.' + id + '.hlink', result);
                    
                } catch (err) {

                    result = {
                        status:  422,
                        error : err.message,
                        stack : err.stack

                    };
                    
                    if ($form)
                        $form.eventData.error = result;
                    

                    XHRData = result;                            
                    // update toolbar
                    if ( gina && typeof(window.ginaToolbar) == 'object' && XHRData ) {
                        try {

                            if ( typeof(XHRData) != 'undefined' ) {
                                window.ginaToolbar.update('data-xhr', XHRData);
                            }

                        } catch (err) {
                            throw err
                        }
                    }

                    triggerEvent(gina, $target, 'error.' + id, result);
                    if (hFormIsRequired)
                        triggerEvent(gina, $target, 'error.' + id + '.hform', result);
                        
                    if (hLinkIsRequired)
                        triggerEvent(gina, $target, 'error.' + id + '.hlink', result);
                }
                
                // handle redirect
                if ( typeof(result) != 'undefined' && typeof(result.location) != 'undefined' ) {                        
                    window.location.hash = ''; //removing hashtag 
                        
                    // if ( window.location.host == gina.config.hostname && /^(http|https)\:\/\//.test(result.location) ) { // same origin
                    //     result.location = result.location.replace( new RegExp(gina.config.hostname), '' );
                    // } else { // external - need to remove `X-Requested-With` from `options.headers`
                        result.location = (!/^http/.test(result.location) && !/^\//.test(result.location) ) ? location.protocol +'//' + result.location : result.location;
                    //}                        
                    
                    window.location.href = result.location;
                    return;                        
                }

            } else if ( xhr.status != 0) {
                
                result = { 'status': xhr.status, 'message': '' };
                // handling blob xhr error
                if ( /blob/.test(xhr.responseType) ) {
                                                
                    blob = new Blob([this.response], { type: 'text/plain' });
                    
                    var reader = new FileReader(), blobError = '';
                    
                    // This fires after the blob has been read/loaded.
                    reader.addEventListener('loadend', (e) => {
                        
                        if ( /string/i.test(typeof(e.srcElement.result)) ) {
                            blobError += e.srcElement.result;
                        } else if ( typeof(e.srcElement.result) == 'object' ) {
                            result = merge(result, e.srcElement.result)
                        } else {
                            result.message += e.srcElement.result
                        }
                        
                        // once ready
                        if ( /^2/.test(reader.readyState) ) {
                            
                            if ( /^(\{|\[)/.test( blobError ) ) {
                                try {
                                    result = merge( result, JSON.parse(blobError) )
                                } catch(err) {
                                    result = merge(result, err)
                                }                                        
                            }
                            
                            if (!result.message)
                                delete result.message;
                            
                            if ($form)
                                $form.eventData.error = result;

                            // forward appplication errors to forms.errors when available
                            if ( typeof(result) != 'undefined' && typeof(result.error) != 'undefined' &&  result.error.fields && typeof(result.error.fields) == 'object') {
                                var formsErrors = {}, errCount = 0;
                                for (var f in result.error.fields) {
                                    ++errCount;
                                    formsErrors[f] = { isApplicationValidationError: result.error.fields[f] };
                                }

                                if (errCount > 0) {
                                    handleErrorsDisplay($form.target, formsErrors);
                                }
                            }

                            // update toolbar
                            XHRData = result;
                            if ( gina && typeof(window.ginaToolbar) == 'object' && XHRData ) {
                                try {
                                    // update toolbar
                                    window.ginaToolbar.update('data-xhr', XHRData );

                                } catch (err) {
                                    throw err
                                }
                            }

                            triggerEvent(gina, $target, 'error.' + id, result);
                            
                            if (hFormIsRequired)
                                triggerEvent(gina, $target, 'error.' + id + '.hform', result);
                                
                            if (hLinkIsRequired)
                                triggerEvent(gina, $target, 'error.' + id + '.hlink', result);
                        }
                        return;
                        
                            
                    });

                    // Start reading the blob as text.
                    reader.readAsText(blob);
                    
                } else { // normal case
                    
                    if ( /^(\{|\[).test( xhr.responseText ) /) {

                        try {
                            result = merge( result, JSON.parse(xhr.responseText) )
                        } catch (err) {
                            result = merge(result, err)
                        }

                    } else if ( typeof(xhr.responseText) == 'object' ) {
                        result = merge(result, xhr.responseText)
                    } else {
                        result.message = xhr.responseText
                    }

                    if ($form)
                        $form.eventData.error = result;

                    // forward appplication errors to forms.errors when available
                    if ( typeof(result) != 'undefined' && typeof(result.error) != 'undefined' &&  result.error.fields && typeof(result.error.fields) == 'object') {
                        var formsErrors = {}, errCount = 0;
                        for (var f in result.error.fields) {
                            ++errCount;
                            formsErrors[f] = { isApplicationValidationError: result.error.fields[f] };
                        }

                        if (errCount > 0) {
                            handleErrorsDisplay($form.target, formsErrors);
                        }
                    }

                    // update toolbar
                    XHRData = result;
                    if ( gina && typeof(window.ginaToolbar) == "object" && XHRData ) {
                        try {
                            // update toolbar
                            window.ginaToolbar.update('data-xhr', XHRData );

                        } catch (err) {
                            throw err
                        }
                    }

                    triggerEvent(gina, $target, 'error.' + id, result);
                    
                    if (hFormIsRequired)
                        triggerEvent(gina, $target, 'error.' + id + '.hform', result);
                        
                    if (hLinkIsRequired)
                        triggerEvent(gina, $target, 'error.' + id + '.hlink', result);                                                                            
                }
                
                return;

                    
            }
        }
    };
    
    // catching request progress
    xhr.onprogress = function(event) {
            
        var percentComplete = '0';
        if (event.lengthComputable) {
            percentComplete = event.loaded / event.total;
            percentComplete = parseInt(percentComplete * 100);

        }

        //var percentComplete = (event.position / event.totalSize)*100;
        var result = {
            'status': 100,
            'progress': percentComplete
        };

        if ($form)
            $form.eventData.onprogress = result;

        triggerEvent(gina, $target, 'progress.' + id, result);
        return;
    };

    // catching timeout
    xhr.ontimeout = function (event) {
        result = {
            'status': 408,
            'error': 'Request Timeout'
        };

        if ($form)
            $form.eventData.ontimeout = result;

        triggerEvent(gina, $target, 'error.' + id, result);
        
        if (hFormIsRequired)
            triggerEvent(gina, $target, 'error.' + id + '.hform', result);
            
        if (hLinkIsRequired)
            triggerEvent(gina, $target, 'error.' + id + '.hlink', result);
            
        return;
    };
    
    
    //return xhr;
}

function removeListener(target, element, name, callback) {
    if (typeof(target.event) != 'undefined' && target.event.isTouchSupported && /^(click|mouseout|mouseover)/.test(name) && target.event[name].indexOf(element) != -1) {
        target.event[name].splice(target.event[name].indexOf(element), 1)
    }

    if (typeof(element) != 'undefined' && element != null) {
        if (element.removeEventListener) {
            element.removeEventListener(name, callback, false)
        } else if (element.attachEvent) {
            element.detachEvent('on' + name, callback)
        }
    } else {
        target.customEvent.removeListener(name, callback)
    }

    if ( typeof(gina.events[name]) != 'undefined' ) {
        // removed ------> [name];
        delete gina.events[name]
    }
}



function on(event, cb) {

    if (!this.plugin) throw new Error('No `plugin` reference found for this event: `'+ event);

    var events = gina.registeredEvents[this.plugin];

    if ( events.indexOf(event) < 0 && !/^init$/.test(event) && !/\.hform$/.test(event) && !/\.hlink$/.test(event) ) {
        cb(new Error('Event `'+ event +'` not handled by ginaEventHandler'))
    } else {
        var $target = null, id = null;
        if ( typeof(this.id) != 'undefined' && typeof(this.id) != 'object' ) {
            $target = this.target || this;
            id      = this.id;
        } else if ( typeof(this.target) != 'undefined'  ) {
            $target = this.target;
            if (!$target) {
                $target = this;
            }
            id      = ( typeof($target.getAttribute) != 'undefined' ) ? $target.getAttribute('id') : this.id;
        } else {
            $target = this.target;
            id      = instance.id;
        }

        if ( this.eventData && !$target.eventData)
            $target.eventData = this.eventData

        if ( /\.(hform|hlink)$/.test(event) ) {            
            event = ( /\.hform$/.test(event) ) ? event.replace(/\.hform$/, '.' + id + '.hform') : event.replace(/\.hlink$/, '.' + id + '.hlink');
        } else { // normal case
            event += '.' + id;
        }
        

        if (!gina.events[event]) {

            addListener(gina, $target, event, function(e) {

                //if ( typeof(e.defaultPrevented) != 'undefined' && e.defaultPrevented)
                cancelEvent(e);

                var data = null;

                if (e['detail']) {
                    data = e['detail'];
                } else if ( typeof(this.eventData.submit) != 'undefined' ) {
                    data = this.eventData.submit
                } else if ( typeof(this.eventData.error) != 'undefined' ) {
                    data = this.eventData.error;
                } else if ( typeof(this.eventData.success) != 'undefined' ) {
                    data = this.eventData.success;
                }

                if (cb)
                    cb(e, data);
            });

            if (this.initialized && !this.isReady)
                triggerEvent(gina, $target, 'init.' + id);

        }

        return this
    }
    
    // Nothing can be added after on()    
        
    
    var listenToXhrEvents = function($el, type) {


        //data-gina-{type}-event-on-success
        var htmlSuccesEventCallback =  $el.target.getAttribute('data-gina-'+ type +'-event-on-success') || null;
        if (htmlSuccesEventCallback != null) {

            if ( /\((.*)\)/.test(htmlSuccesEventCallback) ) {
                eval(htmlSuccesEventCallback)
            } else {
                $el.on('success.h'+ type,  window[htmlSuccesEventCallback])
            }
        }

        //data-gina-{type}-event-on-error
        var htmlErrorEventCallback =  $el.target.getAttribute('data-gina-'+ type +'-event-on-error') || null;
        if (htmlErrorEventCallback != null) {
            if ( /\((.*)\)/.test(htmlErrorEventCallback) ) {
                eval(htmlErrorEventCallback)
            } else {
                $el.on('error.h'+ type, window[htmlErrorEventCallback])
            }
        }
    }
};
define("utils/events", function(){});

/**
 * Credits & thanks to Steven Levithan :)
 * http://blog.stevenlevithan.com/archives/date-time-format
 * 
 * 
 * 
 * Original Copyrights
 * Date Format 1.2.3
 * (c) 2007-2009 Steven Levithan <stevenlevithan.com>
 * MIT license
 *
 * Includes enhancements by Scott Trenda <scott.trenda.net>
 * and Kris Kowal <cixar.com/~kris.kowal/>
 *
 * Accepts a date, a mask, or a date and a mask.
 * Returns a formatted version of the given date.
 * The date defaults to the current date/time.
 * The mask defaults to dateFormat.masks.default.
 *
 * @param {string} date
 * @param {string} mask
 */
function DateFormatHelper() {

    var self = {};

    self.masks = {
        "default":      "ddd mmm dd yyyy HH:MM:ss",
        cookieDate:     "GMT:ddd, dd mmm yyyy HH:MM:ss",
        logger:       "[yyyy mmm dd HH:MM:ss]",
        shortDate:      "m/d/yy",
        shortDate2:      "mm/dd/yyyy",
        mediumDate:     "mmm d, yyyy",
        longDate:       "mmmm d, yyyy",
        fullDate:       "dddd, mmmm d, yyyy",
        shortTime:      "h:MM TT",
        shortTime2:      "h:MM",
        mediumTime:     "h:MM:ss TT",
        mediumTime2:     "h:MM:ss",
        longTime:       "h:MM:ss TT Z",
        longTime2:       "h:MM:ss TT",
        concatenatedDate:  "yyyymmdd",
        isoDate:        "yyyy-mm-dd",
        isoTime:        "HH:MM:ss",
        shortIsoTime:        "HH:MM",
        longIsoTime:        "HH:MM:ss TT",
        isoDateTime:    "yyyy-mm-dd'T'HH:MM:ss",
        isoUtcDateTime: "UTC:yyyy-mm-dd'T'HH:MM:ss'Z'"
    };


    self.i18n = {
        dayNames: [
            "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat",
            "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"
        ],
        monthNames: [
            "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
            "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"
        ]
    };

    var format = function(date, mask, utc) {
        var dF = self;

        var	token = /d{1,4}|m{1,4}|yy(?:yy)?|([HhMsTt])\1?|[LloSZ]|"[^"]*"|'[^']*'/g,
            timezone = /\b(?:[PMCEA][SDP]T|(?:Pacific|Mountain|Central|Eastern|Atlantic) (?:Standard|Daylight|Prevailing) Time|(?:GMT|UTC)(?:[-+]\d{4})?)\b/g,
            timezoneClip = /[^-+\dA-Z]/g,
            pad = function (val, len) {
                val = String(val);
                len = len || 2;
                while (val.length < len) val = "0" + val;
                return val;
            };

        // You can't provide utc if you skip other args (use the "UTC:" mask prefix)
        if (arguments.length == 1 && Object.prototype.toString.call(date) == "[object String]" && !/\d/.test(date)) {
            mask = date;
            date = undefined;
        }

        // Passing date through Date applies Date.parse, if necessary
        date = date ? new Date(date) : new Date();
        if (isNaN(date)) throw SyntaxError("invalid date");

        mask = String(dF.masks[mask] || mask || dF.masks["default"]);

        // Allow setting the utc argument via the mask
        if (mask.slice(0, 4) == "UTC:") {
            mask = mask.slice(4);
            utc = true;
        }

        var	_ = utc ? "getUTC" : "get",
            d = date[_ + "Date"](),
            D = date[_ + "Day"](),
            m = date[_ + "Month"](),
            y = date[_ + "FullYear"](),
            H = date[_ + "Hours"](),
            M = date[_ + "Minutes"](),
            s = date[_ + "Seconds"](),
            L = date[_ + "Milliseconds"](),
            o = utc ? 0 : date.getTimezoneOffset(),
            flags = {
                d:    d,
                dd:   pad(d),
                ddd:  dF.i18n.dayNames[D],
                dddd: dF.i18n.dayNames[D + 7],
                m:    m + 1,
                mm:   pad(m + 1),
                mmm:  dF.i18n.monthNames[m],
                mmmm: dF.i18n.monthNames[m + 12],
                yy:   String(y).slice(2),
                yyyy: y,
                h:    H % 12 || 12,
                hh:   pad(H % 12 || 12),
                H:    H,
                HH:   pad(H),
                M:    M,
                MM:   pad(M),
                s:    s,
                ss:   pad(s),
                l:    pad(L, 3),
                L:    pad(L > 99 ? Math.round(L / 10) : L),
                t:    H < 12 ? "a"  : "p",
                tt:   H < 12 ? "am" : "pm",
                T:    H < 12 ? "A"  : "P",
                TT:   H < 12 ? "AM" : "PM",
                Z:    utc ? "UTC" : (String(date).match(timezone) || [""]).pop().replace(timezoneClip, ""),
                o:    (o > 0 ? "-" : "+") + pad(Math.floor(Math.abs(o) / 60) * 100 + Math.abs(o) % 60, 4),
                S:    ["th", "st", "nd", "rd"][d % 10 > 3 ? 0 : (d % 100 - d % 10 != 10) * d % 10]
            };



        return mask.replace(token, function ($0) {
            return $0 in flags ? flags[$0] : $0.slice(1, $0.length - 1);
        });
    }

    /**
     * Get mask name from a given format
     *
     * @param {string} format
     *
     * @return {string} maskName
     * */
    var getMaskNameFromFormat = function (format) {

        var name = "default";

        for (var f in self.masks) {
            if ( self.masks[f] === format )
                return f
        }

        return name
    }


    /**
     *  Count days from the current date to another
     *
     *  TODO - add a closure to `ignoreWeekend()` based on Lib::Validator
     *  TODO - add a closure to `ignoreFromList(array)` based on Lib::Validator
     *
     *  @param {object} dateTo
     *  @return {number} count
     * */
    var countDaysTo = function(date, dateTo) {

        if ( dateTo instanceof Date) {
            // The number of milliseconds in one day
            var oneDay = 1000 * 60 * 60 * 24

            // Convert both dates to milliseconds
            var date1Ms = date.getTime()
            var date2Ms = dateTo.getTime()

            // Calculate the difference in milliseconds
            var count = Math.abs(date1Ms - date2Ms)

            // Convert back to days and return
            return Math.round(count/oneDay);
        } else {
            throw new Error('dateTo is not instance of Date() !')
        }
    }

    /**
     *  Will give an array of dates between the current date to a targeted date
     *
     *  TODO - add a closure to `ignoreWeekend()` based on Utils::Validator
     *  TODO - add a closure to `ignoreFromList(array)` based on Utils::Validator
     *
     *  @param {object} dateTo
     *  @param {string} [ mask ]
     *
     *  @return {array} dates
     * */
    var getDaysTo = function(date, dateTo, mask) {

        if ( dateTo instanceof Date) {
            var count       = countDaysTo(date, dateTo)
                , month     = date.getMonth()
                , year      = date.getFullYear()
                , day       = date.getDate() + 1
                , dateObj   = new Date(year, month, day)
                , days      = []
                , i         = 0;

            for (; i < count; ++i) {
                if ( typeof(mask) != 'undefined' ) {
                    days.push(new Date(dateObj).format(mask));
                } else {
                    days.push(new Date(dateObj));
                }

                dateObj.setDate(dateObj.getDate() + 1);
            }

            return days || [];
        } else {
            throw new Error('dateTo is not instance of Date() !')
        }
    }

    var getDaysInMonth = function(date) {
        var month   = date.getMonth();
        var year    = date.getFullYear();
        var dateObj = new Date(year, month, 1);
        var days = [];
        while (dateObj.getMonth() === month) {
            days.push(new Date(dateObj));
            dateObj.setDate(dateObj.getDate() + 1);
        }
        return days;
    }

    /**
     * Add or subtract hours
     *  Adding 2 hours
     *      => myDate.addHours(2)
     *  Subtracting 10 hours
     *      => myDate.addHours(-10)
     * */
    var addHours = function(date, h) {
        var copiedDate = new Date(date.getTime());
        copiedDate.setHours(copiedDate.getHours()+h);
        return copiedDate;
    }

    return {
        format          : format,
        countDaysTo     : countDaysTo,
        getDaysTo       : getDaysTo,
        getDaysInMonth  : getDaysInMonth,
        addHours        : addHours
    }

};

if ( ( typeof(module) !== 'undefined' ) && module.exports ) {
    // Publish as node.js module
    module.exports = DateFormatHelper
} else if ( typeof(define) === 'function' && define.amd) {
    // Publish as AMD module
    define( 'helpers/dateFormat',[],function() { return DateFormatHelper })
};
/*! jQuery v1.12.4 | (c) jQuery Foundation | jquery.org/license */
!function(a,b){"object"==typeof module&&"object"==typeof module.exports?module.exports=a.document?b(a,!0):function(a){if(!a.document)throw new Error("jQuery requires a window with a document");return b(a)}:b(a)}("undefined"!=typeof window?window:this,function(a,b){var c=[],d=a.document,e=c.slice,f=c.concat,g=c.push,h=c.indexOf,i={},j=i.toString,k=i.hasOwnProperty,l={},m="1.12.4",n=function(a,b){return new n.fn.init(a,b)},o=/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g,p=/^-ms-/,q=/-([\da-z])/gi,r=function(a,b){return b.toUpperCase()};n.fn=n.prototype={jquery:m,constructor:n,selector:"",length:0,toArray:function(){return e.call(this)},get:function(a){return null!=a?0>a?this[a+this.length]:this[a]:e.call(this)},pushStack:function(a){var b=n.merge(this.constructor(),a);return b.prevObject=this,b.context=this.context,b},each:function(a){return n.each(this,a)},map:function(a){return this.pushStack(n.map(this,function(b,c){return a.call(b,c,b)}))},slice:function(){return this.pushStack(e.apply(this,arguments))},first:function(){return this.eq(0)},last:function(){return this.eq(-1)},eq:function(a){var b=this.length,c=+a+(0>a?b:0);return this.pushStack(c>=0&&b>c?[this[c]]:[])},end:function(){return this.prevObject||this.constructor()},push:g,sort:c.sort,splice:c.splice},n.extend=n.fn.extend=function(){var a,b,c,d,e,f,g=arguments[0]||{},h=1,i=arguments.length,j=!1;for("boolean"==typeof g&&(j=g,g=arguments[h]||{},h++),"object"==typeof g||n.isFunction(g)||(g={}),h===i&&(g=this,h--);i>h;h++)if(null!=(e=arguments[h]))for(d in e)a=g[d],c=e[d],g!==c&&(j&&c&&(n.isPlainObject(c)||(b=n.isArray(c)))?(b?(b=!1,f=a&&n.isArray(a)?a:[]):f=a&&n.isPlainObject(a)?a:{},g[d]=n.extend(j,f,c)):void 0!==c&&(g[d]=c));return g},n.extend({expando:"jQuery"+(m+Math.random()).replace(/\D/g,""),isReady:!0,error:function(a){throw new Error(a)},noop:function(){},isFunction:function(a){return"function"===n.type(a)},isArray:Array.isArray||function(a){return"array"===n.type(a)},isWindow:function(a){return null!=a&&a==a.window},isNumeric:function(a){var b=a&&a.toString();return!n.isArray(a)&&b-parseFloat(b)+1>=0},isEmptyObject:function(a){var b;for(b in a)return!1;return!0},isPlainObject:function(a){var b;if(!a||"object"!==n.type(a)||a.nodeType||n.isWindow(a))return!1;try{if(a.constructor&&!k.call(a,"constructor")&&!k.call(a.constructor.prototype,"isPrototypeOf"))return!1}catch(c){return!1}if(!l.ownFirst)for(b in a)return k.call(a,b);for(b in a);return void 0===b||k.call(a,b)},type:function(a){return null==a?a+"":"object"==typeof a||"function"==typeof a?i[j.call(a)]||"object":typeof a},globalEval:function(b){b&&n.trim(b)&&(a.execScript||function(b){a.eval.call(a,b)})(b)},camelCase:function(a){return a.replace(p,"ms-").replace(q,r)},nodeName:function(a,b){return a.nodeName&&a.nodeName.toLowerCase()===b.toLowerCase()},each:function(a,b){var c,d=0;if(s(a)){for(c=a.length;c>d;d++)if(b.call(a[d],d,a[d])===!1)break}else for(d in a)if(b.call(a[d],d,a[d])===!1)break;return a},trim:function(a){return null==a?"":(a+"").replace(o,"")},makeArray:function(a,b){var c=b||[];return null!=a&&(s(Object(a))?n.merge(c,"string"==typeof a?[a]:a):g.call(c,a)),c},inArray:function(a,b,c){var d;if(b){if(h)return h.call(b,a,c);for(d=b.length,c=c?0>c?Math.max(0,d+c):c:0;d>c;c++)if(c in b&&b[c]===a)return c}return-1},merge:function(a,b){var c=+b.length,d=0,e=a.length;while(c>d)a[e++]=b[d++];if(c!==c)while(void 0!==b[d])a[e++]=b[d++];return a.length=e,a},grep:function(a,b,c){for(var d,e=[],f=0,g=a.length,h=!c;g>f;f++)d=!b(a[f],f),d!==h&&e.push(a[f]);return e},map:function(a,b,c){var d,e,g=0,h=[];if(s(a))for(d=a.length;d>g;g++)e=b(a[g],g,c),null!=e&&h.push(e);else for(g in a)e=b(a[g],g,c),null!=e&&h.push(e);return f.apply([],h)},guid:1,proxy:function(a,b){var c,d,f;return"string"==typeof b&&(f=a[b],b=a,a=f),n.isFunction(a)?(c=e.call(arguments,2),d=function(){return a.apply(b||this,c.concat(e.call(arguments)))},d.guid=a.guid=a.guid||n.guid++,d):void 0},now:function(){return+new Date},support:l}),"function"==typeof Symbol&&(n.fn[Symbol.iterator]=c[Symbol.iterator]),n.each("Boolean Number String Function Array Date RegExp Object Error Symbol".split(" "),function(a,b){i["[object "+b+"]"]=b.toLowerCase()});function s(a){var b=!!a&&"length"in a&&a.length,c=n.type(a);return"function"===c||n.isWindow(a)?!1:"array"===c||0===b||"number"==typeof b&&b>0&&b-1 in a}var t=function(a){var b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q,r,s,t,u="sizzle"+1*new Date,v=a.document,w=0,x=0,y=ga(),z=ga(),A=ga(),B=function(a,b){return a===b&&(l=!0),0},C=1<<31,D={}.hasOwnProperty,E=[],F=E.pop,G=E.push,H=E.push,I=E.slice,J=function(a,b){for(var c=0,d=a.length;d>c;c++)if(a[c]===b)return c;return-1},K="checked|selected|async|autofocus|autoplay|controls|defer|disabled|hidden|ismap|loop|multiple|open|readonly|required|scoped",L="[\\x20\\t\\r\\n\\f]",M="(?:\\\\.|[\\w-]|[^\\x00-\\xa0])+",N="\\["+L+"*("+M+")(?:"+L+"*([*^$|!~]?=)"+L+"*(?:'((?:\\\\.|[^\\\\'])*)'|\"((?:\\\\.|[^\\\\\"])*)\"|("+M+"))|)"+L+"*\\]",O=":("+M+")(?:\\((('((?:\\\\.|[^\\\\'])*)'|\"((?:\\\\.|[^\\\\\"])*)\")|((?:\\\\.|[^\\\\()[\\]]|"+N+")*)|.*)\\)|)",P=new RegExp(L+"+","g"),Q=new RegExp("^"+L+"+|((?:^|[^\\\\])(?:\\\\.)*)"+L+"+$","g"),R=new RegExp("^"+L+"*,"+L+"*"),S=new RegExp("^"+L+"*([>+~]|"+L+")"+L+"*"),T=new RegExp("="+L+"*([^\\]'\"]*?)"+L+"*\\]","g"),U=new RegExp(O),V=new RegExp("^"+M+"$"),W={ID:new RegExp("^#("+M+")"),CLASS:new RegExp("^\\.("+M+")"),TAG:new RegExp("^("+M+"|[*])"),ATTR:new RegExp("^"+N),PSEUDO:new RegExp("^"+O),CHILD:new RegExp("^:(only|first|last|nth|nth-last)-(child|of-type)(?:\\("+L+"*(even|odd|(([+-]|)(\\d*)n|)"+L+"*(?:([+-]|)"+L+"*(\\d+)|))"+L+"*\\)|)","i"),bool:new RegExp("^(?:"+K+")$","i"),needsContext:new RegExp("^"+L+"*[>+~]|:(even|odd|eq|gt|lt|nth|first|last)(?:\\("+L+"*((?:-\\d)?\\d*)"+L+"*\\)|)(?=[^-]|$)","i")},X=/^(?:input|select|textarea|button)$/i,Y=/^h\d$/i,Z=/^[^{]+\{\s*\[native \w/,$=/^(?:#([\w-]+)|(\w+)|\.([\w-]+))$/,_=/[+~]/,aa=/'|\\/g,ba=new RegExp("\\\\([\\da-f]{1,6}"+L+"?|("+L+")|.)","ig"),ca=function(a,b,c){var d="0x"+b-65536;return d!==d||c?b:0>d?String.fromCharCode(d+65536):String.fromCharCode(d>>10|55296,1023&d|56320)},da=function(){m()};try{H.apply(E=I.call(v.childNodes),v.childNodes),E[v.childNodes.length].nodeType}catch(ea){H={apply:E.length?function(a,b){G.apply(a,I.call(b))}:function(a,b){var c=a.length,d=0;while(a[c++]=b[d++]);a.length=c-1}}}function fa(a,b,d,e){var f,h,j,k,l,o,r,s,w=b&&b.ownerDocument,x=b?b.nodeType:9;if(d=d||[],"string"!=typeof a||!a||1!==x&&9!==x&&11!==x)return d;if(!e&&((b?b.ownerDocument||b:v)!==n&&m(b),b=b||n,p)){if(11!==x&&(o=$.exec(a)))if(f=o[1]){if(9===x){if(!(j=b.getElementById(f)))return d;if(j.id===f)return d.push(j),d}else if(w&&(j=w.getElementById(f))&&t(b,j)&&j.id===f)return d.push(j),d}else{if(o[2])return H.apply(d,b.getElementsByTagName(a)),d;if((f=o[3])&&c.getElementsByClassName&&b.getElementsByClassName)return H.apply(d,b.getElementsByClassName(f)),d}if(c.qsa&&!A[a+" "]&&(!q||!q.test(a))){if(1!==x)w=b,s=a;else if("object"!==b.nodeName.toLowerCase()){(k=b.getAttribute("id"))?k=k.replace(aa,"\\$&"):b.setAttribute("id",k=u),r=g(a),h=r.length,l=V.test(k)?"#"+k:"[id='"+k+"']";while(h--)r[h]=l+" "+qa(r[h]);s=r.join(","),w=_.test(a)&&oa(b.parentNode)||b}if(s)try{return H.apply(d,w.querySelectorAll(s)),d}catch(y){}finally{k===u&&b.removeAttribute("id")}}}return i(a.replace(Q,"$1"),b,d,e)}function ga(){var a=[];function b(c,e){return a.push(c+" ")>d.cacheLength&&delete b[a.shift()],b[c+" "]=e}return b}function ha(a){return a[u]=!0,a}function ia(a){var b=n.createElement("div");try{return!!a(b)}catch(c){return!1}finally{b.parentNode&&b.parentNode.removeChild(b),b=null}}function ja(a,b){var c=a.split("|"),e=c.length;while(e--)d.attrHandle[c[e]]=b}function ka(a,b){var c=b&&a,d=c&&1===a.nodeType&&1===b.nodeType&&(~b.sourceIndex||C)-(~a.sourceIndex||C);if(d)return d;if(c)while(c=c.nextSibling)if(c===b)return-1;return a?1:-1}function la(a){return function(b){var c=b.nodeName.toLowerCase();return"input"===c&&b.type===a}}function ma(a){return function(b){var c=b.nodeName.toLowerCase();return("input"===c||"button"===c)&&b.type===a}}function na(a){return ha(function(b){return b=+b,ha(function(c,d){var e,f=a([],c.length,b),g=f.length;while(g--)c[e=f[g]]&&(c[e]=!(d[e]=c[e]))})})}function oa(a){return a&&"undefined"!=typeof a.getElementsByTagName&&a}c=fa.support={},f=fa.isXML=function(a){var b=a&&(a.ownerDocument||a).documentElement;return b?"HTML"!==b.nodeName:!1},m=fa.setDocument=function(a){var b,e,g=a?a.ownerDocument||a:v;return g!==n&&9===g.nodeType&&g.documentElement?(n=g,o=n.documentElement,p=!f(n),(e=n.defaultView)&&e.top!==e&&(e.addEventListener?e.addEventListener("unload",da,!1):e.attachEvent&&e.attachEvent("onunload",da)),c.attributes=ia(function(a){return a.className="i",!a.getAttribute("className")}),c.getElementsByTagName=ia(function(a){return a.appendChild(n.createComment("")),!a.getElementsByTagName("*").length}),c.getElementsByClassName=Z.test(n.getElementsByClassName),c.getById=ia(function(a){return o.appendChild(a).id=u,!n.getElementsByName||!n.getElementsByName(u).length}),c.getById?(d.find.ID=function(a,b){if("undefined"!=typeof b.getElementById&&p){var c=b.getElementById(a);return c?[c]:[]}},d.filter.ID=function(a){var b=a.replace(ba,ca);return function(a){return a.getAttribute("id")===b}}):(delete d.find.ID,d.filter.ID=function(a){var b=a.replace(ba,ca);return function(a){var c="undefined"!=typeof a.getAttributeNode&&a.getAttributeNode("id");return c&&c.value===b}}),d.find.TAG=c.getElementsByTagName?function(a,b){return"undefined"!=typeof b.getElementsByTagName?b.getElementsByTagName(a):c.qsa?b.querySelectorAll(a):void 0}:function(a,b){var c,d=[],e=0,f=b.getElementsByTagName(a);if("*"===a){while(c=f[e++])1===c.nodeType&&d.push(c);return d}return f},d.find.CLASS=c.getElementsByClassName&&function(a,b){return"undefined"!=typeof b.getElementsByClassName&&p?b.getElementsByClassName(a):void 0},r=[],q=[],(c.qsa=Z.test(n.querySelectorAll))&&(ia(function(a){o.appendChild(a).innerHTML="<a id='"+u+"'></a><select id='"+u+"-\r\\' msallowcapture=''><option selected=''></option></select>",a.querySelectorAll("[msallowcapture^='']").length&&q.push("[*^$]="+L+"*(?:''|\"\")"),a.querySelectorAll("[selected]").length||q.push("\\["+L+"*(?:value|"+K+")"),a.querySelectorAll("[id~="+u+"-]").length||q.push("~="),a.querySelectorAll(":checked").length||q.push(":checked"),a.querySelectorAll("a#"+u+"+*").length||q.push(".#.+[+~]")}),ia(function(a){var b=n.createElement("input");b.setAttribute("type","hidden"),a.appendChild(b).setAttribute("name","D"),a.querySelectorAll("[name=d]").length&&q.push("name"+L+"*[*^$|!~]?="),a.querySelectorAll(":enabled").length||q.push(":enabled",":disabled"),a.querySelectorAll("*,:x"),q.push(",.*:")})),(c.matchesSelector=Z.test(s=o.matches||o.webkitMatchesSelector||o.mozMatchesSelector||o.oMatchesSelector||o.msMatchesSelector))&&ia(function(a){c.disconnectedMatch=s.call(a,"div"),s.call(a,"[s!='']:x"),r.push("!=",O)}),q=q.length&&new RegExp(q.join("|")),r=r.length&&new RegExp(r.join("|")),b=Z.test(o.compareDocumentPosition),t=b||Z.test(o.contains)?function(a,b){var c=9===a.nodeType?a.documentElement:a,d=b&&b.parentNode;return a===d||!(!d||1!==d.nodeType||!(c.contains?c.contains(d):a.compareDocumentPosition&&16&a.compareDocumentPosition(d)))}:function(a,b){if(b)while(b=b.parentNode)if(b===a)return!0;return!1},B=b?function(a,b){if(a===b)return l=!0,0;var d=!a.compareDocumentPosition-!b.compareDocumentPosition;return d?d:(d=(a.ownerDocument||a)===(b.ownerDocument||b)?a.compareDocumentPosition(b):1,1&d||!c.sortDetached&&b.compareDocumentPosition(a)===d?a===n||a.ownerDocument===v&&t(v,a)?-1:b===n||b.ownerDocument===v&&t(v,b)?1:k?J(k,a)-J(k,b):0:4&d?-1:1)}:function(a,b){if(a===b)return l=!0,0;var c,d=0,e=a.parentNode,f=b.parentNode,g=[a],h=[b];if(!e||!f)return a===n?-1:b===n?1:e?-1:f?1:k?J(k,a)-J(k,b):0;if(e===f)return ka(a,b);c=a;while(c=c.parentNode)g.unshift(c);c=b;while(c=c.parentNode)h.unshift(c);while(g[d]===h[d])d++;return d?ka(g[d],h[d]):g[d]===v?-1:h[d]===v?1:0},n):n},fa.matches=function(a,b){return fa(a,null,null,b)},fa.matchesSelector=function(a,b){if((a.ownerDocument||a)!==n&&m(a),b=b.replace(T,"='$1']"),c.matchesSelector&&p&&!A[b+" "]&&(!r||!r.test(b))&&(!q||!q.test(b)))try{var d=s.call(a,b);if(d||c.disconnectedMatch||a.document&&11!==a.document.nodeType)return d}catch(e){}return fa(b,n,null,[a]).length>0},fa.contains=function(a,b){return(a.ownerDocument||a)!==n&&m(a),t(a,b)},fa.attr=function(a,b){(a.ownerDocument||a)!==n&&m(a);var e=d.attrHandle[b.toLowerCase()],f=e&&D.call(d.attrHandle,b.toLowerCase())?e(a,b,!p):void 0;return void 0!==f?f:c.attributes||!p?a.getAttribute(b):(f=a.getAttributeNode(b))&&f.specified?f.value:null},fa.error=function(a){throw new Error("Syntax error, unrecognized expression: "+a)},fa.uniqueSort=function(a){var b,d=[],e=0,f=0;if(l=!c.detectDuplicates,k=!c.sortStable&&a.slice(0),a.sort(B),l){while(b=a[f++])b===a[f]&&(e=d.push(f));while(e--)a.splice(d[e],1)}return k=null,a},e=fa.getText=function(a){var b,c="",d=0,f=a.nodeType;if(f){if(1===f||9===f||11===f){if("string"==typeof a.textContent)return a.textContent;for(a=a.firstChild;a;a=a.nextSibling)c+=e(a)}else if(3===f||4===f)return a.nodeValue}else while(b=a[d++])c+=e(b);return c},d=fa.selectors={cacheLength:50,createPseudo:ha,match:W,attrHandle:{},find:{},relative:{">":{dir:"parentNode",first:!0}," ":{dir:"parentNode"},"+":{dir:"previousSibling",first:!0},"~":{dir:"previousSibling"}},preFilter:{ATTR:function(a){return a[1]=a[1].replace(ba,ca),a[3]=(a[3]||a[4]||a[5]||"").replace(ba,ca),"~="===a[2]&&(a[3]=" "+a[3]+" "),a.slice(0,4)},CHILD:function(a){return a[1]=a[1].toLowerCase(),"nth"===a[1].slice(0,3)?(a[3]||fa.error(a[0]),a[4]=+(a[4]?a[5]+(a[6]||1):2*("even"===a[3]||"odd"===a[3])),a[5]=+(a[7]+a[8]||"odd"===a[3])):a[3]&&fa.error(a[0]),a},PSEUDO:function(a){var b,c=!a[6]&&a[2];return W.CHILD.test(a[0])?null:(a[3]?a[2]=a[4]||a[5]||"":c&&U.test(c)&&(b=g(c,!0))&&(b=c.indexOf(")",c.length-b)-c.length)&&(a[0]=a[0].slice(0,b),a[2]=c.slice(0,b)),a.slice(0,3))}},filter:{TAG:function(a){var b=a.replace(ba,ca).toLowerCase();return"*"===a?function(){return!0}:function(a){return a.nodeName&&a.nodeName.toLowerCase()===b}},CLASS:function(a){var b=y[a+" "];return b||(b=new RegExp("(^|"+L+")"+a+"("+L+"|$)"))&&y(a,function(a){return b.test("string"==typeof a.className&&a.className||"undefined"!=typeof a.getAttribute&&a.getAttribute("class")||"")})},ATTR:function(a,b,c){return function(d){var e=fa.attr(d,a);return null==e?"!="===b:b?(e+="","="===b?e===c:"!="===b?e!==c:"^="===b?c&&0===e.indexOf(c):"*="===b?c&&e.indexOf(c)>-1:"$="===b?c&&e.slice(-c.length)===c:"~="===b?(" "+e.replace(P," ")+" ").indexOf(c)>-1:"|="===b?e===c||e.slice(0,c.length+1)===c+"-":!1):!0}},CHILD:function(a,b,c,d,e){var f="nth"!==a.slice(0,3),g="last"!==a.slice(-4),h="of-type"===b;return 1===d&&0===e?function(a){return!!a.parentNode}:function(b,c,i){var j,k,l,m,n,o,p=f!==g?"nextSibling":"previousSibling",q=b.parentNode,r=h&&b.nodeName.toLowerCase(),s=!i&&!h,t=!1;if(q){if(f){while(p){m=b;while(m=m[p])if(h?m.nodeName.toLowerCase()===r:1===m.nodeType)return!1;o=p="only"===a&&!o&&"nextSibling"}return!0}if(o=[g?q.firstChild:q.lastChild],g&&s){m=q,l=m[u]||(m[u]={}),k=l[m.uniqueID]||(l[m.uniqueID]={}),j=k[a]||[],n=j[0]===w&&j[1],t=n&&j[2],m=n&&q.childNodes[n];while(m=++n&&m&&m[p]||(t=n=0)||o.pop())if(1===m.nodeType&&++t&&m===b){k[a]=[w,n,t];break}}else if(s&&(m=b,l=m[u]||(m[u]={}),k=l[m.uniqueID]||(l[m.uniqueID]={}),j=k[a]||[],n=j[0]===w&&j[1],t=n),t===!1)while(m=++n&&m&&m[p]||(t=n=0)||o.pop())if((h?m.nodeName.toLowerCase()===r:1===m.nodeType)&&++t&&(s&&(l=m[u]||(m[u]={}),k=l[m.uniqueID]||(l[m.uniqueID]={}),k[a]=[w,t]),m===b))break;return t-=e,t===d||t%d===0&&t/d>=0}}},PSEUDO:function(a,b){var c,e=d.pseudos[a]||d.setFilters[a.toLowerCase()]||fa.error("unsupported pseudo: "+a);return e[u]?e(b):e.length>1?(c=[a,a,"",b],d.setFilters.hasOwnProperty(a.toLowerCase())?ha(function(a,c){var d,f=e(a,b),g=f.length;while(g--)d=J(a,f[g]),a[d]=!(c[d]=f[g])}):function(a){return e(a,0,c)}):e}},pseudos:{not:ha(function(a){var b=[],c=[],d=h(a.replace(Q,"$1"));return d[u]?ha(function(a,b,c,e){var f,g=d(a,null,e,[]),h=a.length;while(h--)(f=g[h])&&(a[h]=!(b[h]=f))}):function(a,e,f){return b[0]=a,d(b,null,f,c),b[0]=null,!c.pop()}}),has:ha(function(a){return function(b){return fa(a,b).length>0}}),contains:ha(function(a){return a=a.replace(ba,ca),function(b){return(b.textContent||b.innerText||e(b)).indexOf(a)>-1}}),lang:ha(function(a){return V.test(a||"")||fa.error("unsupported lang: "+a),a=a.replace(ba,ca).toLowerCase(),function(b){var c;do if(c=p?b.lang:b.getAttribute("xml:lang")||b.getAttribute("lang"))return c=c.toLowerCase(),c===a||0===c.indexOf(a+"-");while((b=b.parentNode)&&1===b.nodeType);return!1}}),target:function(b){var c=a.location&&a.location.hash;return c&&c.slice(1)===b.id},root:function(a){return a===o},focus:function(a){return a===n.activeElement&&(!n.hasFocus||n.hasFocus())&&!!(a.type||a.href||~a.tabIndex)},enabled:function(a){return a.disabled===!1},disabled:function(a){return a.disabled===!0},checked:function(a){var b=a.nodeName.toLowerCase();return"input"===b&&!!a.checked||"option"===b&&!!a.selected},selected:function(a){return a.parentNode&&a.parentNode.selectedIndex,a.selected===!0},empty:function(a){for(a=a.firstChild;a;a=a.nextSibling)if(a.nodeType<6)return!1;return!0},parent:function(a){return!d.pseudos.empty(a)},header:function(a){return Y.test(a.nodeName)},input:function(a){return X.test(a.nodeName)},button:function(a){var b=a.nodeName.toLowerCase();return"input"===b&&"button"===a.type||"button"===b},text:function(a){var b;return"input"===a.nodeName.toLowerCase()&&"text"===a.type&&(null==(b=a.getAttribute("type"))||"text"===b.toLowerCase())},first:na(function(){return[0]}),last:na(function(a,b){return[b-1]}),eq:na(function(a,b,c){return[0>c?c+b:c]}),even:na(function(a,b){for(var c=0;b>c;c+=2)a.push(c);return a}),odd:na(function(a,b){for(var c=1;b>c;c+=2)a.push(c);return a}),lt:na(function(a,b,c){for(var d=0>c?c+b:c;--d>=0;)a.push(d);return a}),gt:na(function(a,b,c){for(var d=0>c?c+b:c;++d<b;)a.push(d);return a})}},d.pseudos.nth=d.pseudos.eq;for(b in{radio:!0,checkbox:!0,file:!0,password:!0,image:!0})d.pseudos[b]=la(b);for(b in{submit:!0,reset:!0})d.pseudos[b]=ma(b);function pa(){}pa.prototype=d.filters=d.pseudos,d.setFilters=new pa,g=fa.tokenize=function(a,b){var c,e,f,g,h,i,j,k=z[a+" "];if(k)return b?0:k.slice(0);h=a,i=[],j=d.preFilter;while(h){c&&!(e=R.exec(h))||(e&&(h=h.slice(e[0].length)||h),i.push(f=[])),c=!1,(e=S.exec(h))&&(c=e.shift(),f.push({value:c,type:e[0].replace(Q," ")}),h=h.slice(c.length));for(g in d.filter)!(e=W[g].exec(h))||j[g]&&!(e=j[g](e))||(c=e.shift(),f.push({value:c,type:g,matches:e}),h=h.slice(c.length));if(!c)break}return b?h.length:h?fa.error(a):z(a,i).slice(0)};function qa(a){for(var b=0,c=a.length,d="";c>b;b++)d+=a[b].value;return d}function ra(a,b,c){var d=b.dir,e=c&&"parentNode"===d,f=x++;return b.first?function(b,c,f){while(b=b[d])if(1===b.nodeType||e)return a(b,c,f)}:function(b,c,g){var h,i,j,k=[w,f];if(g){while(b=b[d])if((1===b.nodeType||e)&&a(b,c,g))return!0}else while(b=b[d])if(1===b.nodeType||e){if(j=b[u]||(b[u]={}),i=j[b.uniqueID]||(j[b.uniqueID]={}),(h=i[d])&&h[0]===w&&h[1]===f)return k[2]=h[2];if(i[d]=k,k[2]=a(b,c,g))return!0}}}function sa(a){return a.length>1?function(b,c,d){var e=a.length;while(e--)if(!a[e](b,c,d))return!1;return!0}:a[0]}function ta(a,b,c){for(var d=0,e=b.length;e>d;d++)fa(a,b[d],c);return c}function ua(a,b,c,d,e){for(var f,g=[],h=0,i=a.length,j=null!=b;i>h;h++)(f=a[h])&&(c&&!c(f,d,e)||(g.push(f),j&&b.push(h)));return g}function va(a,b,c,d,e,f){return d&&!d[u]&&(d=va(d)),e&&!e[u]&&(e=va(e,f)),ha(function(f,g,h,i){var j,k,l,m=[],n=[],o=g.length,p=f||ta(b||"*",h.nodeType?[h]:h,[]),q=!a||!f&&b?p:ua(p,m,a,h,i),r=c?e||(f?a:o||d)?[]:g:q;if(c&&c(q,r,h,i),d){j=ua(r,n),d(j,[],h,i),k=j.length;while(k--)(l=j[k])&&(r[n[k]]=!(q[n[k]]=l))}if(f){if(e||a){if(e){j=[],k=r.length;while(k--)(l=r[k])&&j.push(q[k]=l);e(null,r=[],j,i)}k=r.length;while(k--)(l=r[k])&&(j=e?J(f,l):m[k])>-1&&(f[j]=!(g[j]=l))}}else r=ua(r===g?r.splice(o,r.length):r),e?e(null,g,r,i):H.apply(g,r)})}function wa(a){for(var b,c,e,f=a.length,g=d.relative[a[0].type],h=g||d.relative[" "],i=g?1:0,k=ra(function(a){return a===b},h,!0),l=ra(function(a){return J(b,a)>-1},h,!0),m=[function(a,c,d){var e=!g&&(d||c!==j)||((b=c).nodeType?k(a,c,d):l(a,c,d));return b=null,e}];f>i;i++)if(c=d.relative[a[i].type])m=[ra(sa(m),c)];else{if(c=d.filter[a[i].type].apply(null,a[i].matches),c[u]){for(e=++i;f>e;e++)if(d.relative[a[e].type])break;return va(i>1&&sa(m),i>1&&qa(a.slice(0,i-1).concat({value:" "===a[i-2].type?"*":""})).replace(Q,"$1"),c,e>i&&wa(a.slice(i,e)),f>e&&wa(a=a.slice(e)),f>e&&qa(a))}m.push(c)}return sa(m)}function xa(a,b){var c=b.length>0,e=a.length>0,f=function(f,g,h,i,k){var l,o,q,r=0,s="0",t=f&&[],u=[],v=j,x=f||e&&d.find.TAG("*",k),y=w+=null==v?1:Math.random()||.1,z=x.length;for(k&&(j=g===n||g||k);s!==z&&null!=(l=x[s]);s++){if(e&&l){o=0,g||l.ownerDocument===n||(m(l),h=!p);while(q=a[o++])if(q(l,g||n,h)){i.push(l);break}k&&(w=y)}c&&((l=!q&&l)&&r--,f&&t.push(l))}if(r+=s,c&&s!==r){o=0;while(q=b[o++])q(t,u,g,h);if(f){if(r>0)while(s--)t[s]||u[s]||(u[s]=F.call(i));u=ua(u)}H.apply(i,u),k&&!f&&u.length>0&&r+b.length>1&&fa.uniqueSort(i)}return k&&(w=y,j=v),t};return c?ha(f):f}return h=fa.compile=function(a,b){var c,d=[],e=[],f=A[a+" "];if(!f){b||(b=g(a)),c=b.length;while(c--)f=wa(b[c]),f[u]?d.push(f):e.push(f);f=A(a,xa(e,d)),f.selector=a}return f},i=fa.select=function(a,b,e,f){var i,j,k,l,m,n="function"==typeof a&&a,o=!f&&g(a=n.selector||a);if(e=e||[],1===o.length){if(j=o[0]=o[0].slice(0),j.length>2&&"ID"===(k=j[0]).type&&c.getById&&9===b.nodeType&&p&&d.relative[j[1].type]){if(b=(d.find.ID(k.matches[0].replace(ba,ca),b)||[])[0],!b)return e;n&&(b=b.parentNode),a=a.slice(j.shift().value.length)}i=W.needsContext.test(a)?0:j.length;while(i--){if(k=j[i],d.relative[l=k.type])break;if((m=d.find[l])&&(f=m(k.matches[0].replace(ba,ca),_.test(j[0].type)&&oa(b.parentNode)||b))){if(j.splice(i,1),a=f.length&&qa(j),!a)return H.apply(e,f),e;break}}}return(n||h(a,o))(f,b,!p,e,!b||_.test(a)&&oa(b.parentNode)||b),e},c.sortStable=u.split("").sort(B).join("")===u,c.detectDuplicates=!!l,m(),c.sortDetached=ia(function(a){return 1&a.compareDocumentPosition(n.createElement("div"))}),ia(function(a){return a.innerHTML="<a href='#'></a>","#"===a.firstChild.getAttribute("href")})||ja("type|href|height|width",function(a,b,c){return c?void 0:a.getAttribute(b,"type"===b.toLowerCase()?1:2)}),c.attributes&&ia(function(a){return a.innerHTML="<input/>",a.firstChild.setAttribute("value",""),""===a.firstChild.getAttribute("value")})||ja("value",function(a,b,c){return c||"input"!==a.nodeName.toLowerCase()?void 0:a.defaultValue}),ia(function(a){return null==a.getAttribute("disabled")})||ja(K,function(a,b,c){var d;return c?void 0:a[b]===!0?b.toLowerCase():(d=a.getAttributeNode(b))&&d.specified?d.value:null}),fa}(a);n.find=t,n.expr=t.selectors,n.expr[":"]=n.expr.pseudos,n.uniqueSort=n.unique=t.uniqueSort,n.text=t.getText,n.isXMLDoc=t.isXML,n.contains=t.contains;var u=function(a,b,c){var d=[],e=void 0!==c;while((a=a[b])&&9!==a.nodeType)if(1===a.nodeType){if(e&&n(a).is(c))break;d.push(a)}return d},v=function(a,b){for(var c=[];a;a=a.nextSibling)1===a.nodeType&&a!==b&&c.push(a);return c},w=n.expr.match.needsContext,x=/^<([\w-]+)\s*\/?>(?:<\/\1>|)$/,y=/^.[^:#\[\.,]*$/;function z(a,b,c){if(n.isFunction(b))return n.grep(a,function(a,d){return!!b.call(a,d,a)!==c});if(b.nodeType)return n.grep(a,function(a){return a===b!==c});if("string"==typeof b){if(y.test(b))return n.filter(b,a,c);b=n.filter(b,a)}return n.grep(a,function(a){return n.inArray(a,b)>-1!==c})}n.filter=function(a,b,c){var d=b[0];return c&&(a=":not("+a+")"),1===b.length&&1===d.nodeType?n.find.matchesSelector(d,a)?[d]:[]:n.find.matches(a,n.grep(b,function(a){return 1===a.nodeType}))},n.fn.extend({find:function(a){var b,c=[],d=this,e=d.length;if("string"!=typeof a)return this.pushStack(n(a).filter(function(){for(b=0;e>b;b++)if(n.contains(d[b],this))return!0}));for(b=0;e>b;b++)n.find(a,d[b],c);return c=this.pushStack(e>1?n.unique(c):c),c.selector=this.selector?this.selector+" "+a:a,c},filter:function(a){return this.pushStack(z(this,a||[],!1))},not:function(a){return this.pushStack(z(this,a||[],!0))},is:function(a){return!!z(this,"string"==typeof a&&w.test(a)?n(a):a||[],!1).length}});var A,B=/^(?:\s*(<[\w\W]+>)[^>]*|#([\w-]*))$/,C=n.fn.init=function(a,b,c){var e,f;if(!a)return this;if(c=c||A,"string"==typeof a){if(e="<"===a.charAt(0)&&">"===a.charAt(a.length-1)&&a.length>=3?[null,a,null]:B.exec(a),!e||!e[1]&&b)return!b||b.jquery?(b||c).find(a):this.constructor(b).find(a);if(e[1]){if(b=b instanceof n?b[0]:b,n.merge(this,n.parseHTML(e[1],b&&b.nodeType?b.ownerDocument||b:d,!0)),x.test(e[1])&&n.isPlainObject(b))for(e in b)n.isFunction(this[e])?this[e](b[e]):this.attr(e,b[e]);return this}if(f=d.getElementById(e[2]),f&&f.parentNode){if(f.id!==e[2])return A.find(a);this.length=1,this[0]=f}return this.context=d,this.selector=a,this}return a.nodeType?(this.context=this[0]=a,this.length=1,this):n.isFunction(a)?"undefined"!=typeof c.ready?c.ready(a):a(n):(void 0!==a.selector&&(this.selector=a.selector,this.context=a.context),n.makeArray(a,this))};C.prototype=n.fn,A=n(d);var D=/^(?:parents|prev(?:Until|All))/,E={children:!0,contents:!0,next:!0,prev:!0};n.fn.extend({has:function(a){var b,c=n(a,this),d=c.length;return this.filter(function(){for(b=0;d>b;b++)if(n.contains(this,c[b]))return!0})},closest:function(a,b){for(var c,d=0,e=this.length,f=[],g=w.test(a)||"string"!=typeof a?n(a,b||this.context):0;e>d;d++)for(c=this[d];c&&c!==b;c=c.parentNode)if(c.nodeType<11&&(g?g.index(c)>-1:1===c.nodeType&&n.find.matchesSelector(c,a))){f.push(c);break}return this.pushStack(f.length>1?n.uniqueSort(f):f)},index:function(a){return a?"string"==typeof a?n.inArray(this[0],n(a)):n.inArray(a.jquery?a[0]:a,this):this[0]&&this[0].parentNode?this.first().prevAll().length:-1},add:function(a,b){return this.pushStack(n.uniqueSort(n.merge(this.get(),n(a,b))))},addBack:function(a){return this.add(null==a?this.prevObject:this.prevObject.filter(a))}});function F(a,b){do a=a[b];while(a&&1!==a.nodeType);return a}n.each({parent:function(a){var b=a.parentNode;return b&&11!==b.nodeType?b:null},parents:function(a){return u(a,"parentNode")},parentsUntil:function(a,b,c){return u(a,"parentNode",c)},next:function(a){return F(a,"nextSibling")},prev:function(a){return F(a,"previousSibling")},nextAll:function(a){return u(a,"nextSibling")},prevAll:function(a){return u(a,"previousSibling")},nextUntil:function(a,b,c){return u(a,"nextSibling",c)},prevUntil:function(a,b,c){return u(a,"previousSibling",c)},siblings:function(a){return v((a.parentNode||{}).firstChild,a)},children:function(a){return v(a.firstChild)},contents:function(a){return n.nodeName(a,"iframe")?a.contentDocument||a.contentWindow.document:n.merge([],a.childNodes)}},function(a,b){n.fn[a]=function(c,d){var e=n.map(this,b,c);return"Until"!==a.slice(-5)&&(d=c),d&&"string"==typeof d&&(e=n.filter(d,e)),this.length>1&&(E[a]||(e=n.uniqueSort(e)),D.test(a)&&(e=e.reverse())),this.pushStack(e)}});var G=/\S+/g;function H(a){var b={};return n.each(a.match(G)||[],function(a,c){b[c]=!0}),b}n.Callbacks=function(a){a="string"==typeof a?H(a):n.extend({},a);var b,c,d,e,f=[],g=[],h=-1,i=function(){for(e=a.once,d=b=!0;g.length;h=-1){c=g.shift();while(++h<f.length)f[h].apply(c[0],c[1])===!1&&a.stopOnFalse&&(h=f.length,c=!1)}a.memory||(c=!1),b=!1,e&&(f=c?[]:"")},j={add:function(){return f&&(c&&!b&&(h=f.length-1,g.push(c)),function d(b){n.each(b,function(b,c){n.isFunction(c)?a.unique&&j.has(c)||f.push(c):c&&c.length&&"string"!==n.type(c)&&d(c)})}(arguments),c&&!b&&i()),this},remove:function(){return n.each(arguments,function(a,b){var c;while((c=n.inArray(b,f,c))>-1)f.splice(c,1),h>=c&&h--}),this},has:function(a){return a?n.inArray(a,f)>-1:f.length>0},empty:function(){return f&&(f=[]),this},disable:function(){return e=g=[],f=c="",this},disabled:function(){return!f},lock:function(){return e=!0,c||j.disable(),this},locked:function(){return!!e},fireWith:function(a,c){return e||(c=c||[],c=[a,c.slice?c.slice():c],g.push(c),b||i()),this},fire:function(){return j.fireWith(this,arguments),this},fired:function(){return!!d}};return j},n.extend({Deferred:function(a){var b=[["resolve","done",n.Callbacks("once memory"),"resolved"],["reject","fail",n.Callbacks("once memory"),"rejected"],["notify","progress",n.Callbacks("memory")]],c="pending",d={state:function(){return c},always:function(){return e.done(arguments).fail(arguments),this},then:function(){var a=arguments;return n.Deferred(function(c){n.each(b,function(b,f){var g=n.isFunction(a[b])&&a[b];e[f[1]](function(){var a=g&&g.apply(this,arguments);a&&n.isFunction(a.promise)?a.promise().progress(c.notify).done(c.resolve).fail(c.reject):c[f[0]+"With"](this===d?c.promise():this,g?[a]:arguments)})}),a=null}).promise()},promise:function(a){return null!=a?n.extend(a,d):d}},e={};return d.pipe=d.then,n.each(b,function(a,f){var g=f[2],h=f[3];d[f[1]]=g.add,h&&g.add(function(){c=h},b[1^a][2].disable,b[2][2].lock),e[f[0]]=function(){return e[f[0]+"With"](this===e?d:this,arguments),this},e[f[0]+"With"]=g.fireWith}),d.promise(e),a&&a.call(e,e),e},when:function(a){var b=0,c=e.call(arguments),d=c.length,f=1!==d||a&&n.isFunction(a.promise)?d:0,g=1===f?a:n.Deferred(),h=function(a,b,c){return function(d){b[a]=this,c[a]=arguments.length>1?e.call(arguments):d,c===i?g.notifyWith(b,c):--f||g.resolveWith(b,c)}},i,j,k;if(d>1)for(i=new Array(d),j=new Array(d),k=new Array(d);d>b;b++)c[b]&&n.isFunction(c[b].promise)?c[b].promise().progress(h(b,j,i)).done(h(b,k,c)).fail(g.reject):--f;return f||g.resolveWith(k,c),g.promise()}});var I;n.fn.ready=function(a){return n.ready.promise().done(a),this},n.extend({isReady:!1,readyWait:1,holdReady:function(a){a?n.readyWait++:n.ready(!0)},ready:function(a){(a===!0?--n.readyWait:n.isReady)||(n.isReady=!0,a!==!0&&--n.readyWait>0||(I.resolveWith(d,[n]),n.fn.triggerHandler&&(n(d).triggerHandler("ready"),n(d).off("ready"))))}});function J(){d.addEventListener?(d.removeEventListener("DOMContentLoaded",K),a.removeEventListener("load",K)):(d.detachEvent("onreadystatechange",K),a.detachEvent("onload",K))}function K(){(d.addEventListener||"load"===a.event.type||"complete"===d.readyState)&&(J(),n.ready())}n.ready.promise=function(b){if(!I)if(I=n.Deferred(),"complete"===d.readyState||"loading"!==d.readyState&&!d.documentElement.doScroll)a.setTimeout(n.ready);else if(d.addEventListener)d.addEventListener("DOMContentLoaded",K),a.addEventListener("load",K);else{d.attachEvent("onreadystatechange",K),a.attachEvent("onload",K);var c=!1;try{c=null==a.frameElement&&d.documentElement}catch(e){}c&&c.doScroll&&!function f(){if(!n.isReady){try{c.doScroll("left")}catch(b){return a.setTimeout(f,50)}J(),n.ready()}}()}return I.promise(b)},n.ready.promise();var L;for(L in n(l))break;l.ownFirst="0"===L,l.inlineBlockNeedsLayout=!1,n(function(){var a,b,c,e;c=d.getElementsByTagName("body")[0],c&&c.style&&(b=d.createElement("div"),e=d.createElement("div"),e.style.cssText="position:absolute;border:0;width:0;height:0;top:0;left:-9999px",c.appendChild(e).appendChild(b),"undefined"!=typeof b.style.zoom&&(b.style.cssText="display:inline;margin:0;border:0;padding:1px;width:1px;zoom:1",l.inlineBlockNeedsLayout=a=3===b.offsetWidth,a&&(c.style.zoom=1)),c.removeChild(e))}),function(){var a=d.createElement("div");l.deleteExpando=!0;try{delete a.test}catch(b){l.deleteExpando=!1}a=null}();var M=function(a){var b=n.noData[(a.nodeName+" ").toLowerCase()],c=+a.nodeType||1;return 1!==c&&9!==c?!1:!b||b!==!0&&a.getAttribute("classid")===b},N=/^(?:\{[\w\W]*\}|\[[\w\W]*\])$/,O=/([A-Z])/g;function P(a,b,c){if(void 0===c&&1===a.nodeType){var d="data-"+b.replace(O,"-$1").toLowerCase();if(c=a.getAttribute(d),"string"==typeof c){try{c="true"===c?!0:"false"===c?!1:"null"===c?null:+c+""===c?+c:N.test(c)?n.parseJSON(c):c}catch(e){}n.data(a,b,c)}else c=void 0;
}return c}function Q(a){var b;for(b in a)if(("data"!==b||!n.isEmptyObject(a[b]))&&"toJSON"!==b)return!1;return!0}function R(a,b,d,e){if(M(a)){var f,g,h=n.expando,i=a.nodeType,j=i?n.cache:a,k=i?a[h]:a[h]&&h;if(k&&j[k]&&(e||j[k].data)||void 0!==d||"string"!=typeof b)return k||(k=i?a[h]=c.pop()||n.guid++:h),j[k]||(j[k]=i?{}:{toJSON:n.noop}),"object"!=typeof b&&"function"!=typeof b||(e?j[k]=n.extend(j[k],b):j[k].data=n.extend(j[k].data,b)),g=j[k],e||(g.data||(g.data={}),g=g.data),void 0!==d&&(g[n.camelCase(b)]=d),"string"==typeof b?(f=g[b],null==f&&(f=g[n.camelCase(b)])):f=g,f}}function S(a,b,c){if(M(a)){var d,e,f=a.nodeType,g=f?n.cache:a,h=f?a[n.expando]:n.expando;if(g[h]){if(b&&(d=c?g[h]:g[h].data)){n.isArray(b)?b=b.concat(n.map(b,n.camelCase)):b in d?b=[b]:(b=n.camelCase(b),b=b in d?[b]:b.split(" ")),e=b.length;while(e--)delete d[b[e]];if(c?!Q(d):!n.isEmptyObject(d))return}(c||(delete g[h].data,Q(g[h])))&&(f?n.cleanData([a],!0):l.deleteExpando||g!=g.window?delete g[h]:g[h]=void 0)}}}n.extend({cache:{},noData:{"applet ":!0,"embed ":!0,"object ":"clsid:D27CDB6E-AE6D-11cf-96B8-444553540000"},hasData:function(a){return a=a.nodeType?n.cache[a[n.expando]]:a[n.expando],!!a&&!Q(a)},data:function(a,b,c){return R(a,b,c)},removeData:function(a,b){return S(a,b)},_data:function(a,b,c){return R(a,b,c,!0)},_removeData:function(a,b){return S(a,b,!0)}}),n.fn.extend({data:function(a,b){var c,d,e,f=this[0],g=f&&f.attributes;if(void 0===a){if(this.length&&(e=n.data(f),1===f.nodeType&&!n._data(f,"parsedAttrs"))){c=g.length;while(c--)g[c]&&(d=g[c].name,0===d.indexOf("data-")&&(d=n.camelCase(d.slice(5)),P(f,d,e[d])));n._data(f,"parsedAttrs",!0)}return e}return"object"==typeof a?this.each(function(){n.data(this,a)}):arguments.length>1?this.each(function(){n.data(this,a,b)}):f?P(f,a,n.data(f,a)):void 0},removeData:function(a){return this.each(function(){n.removeData(this,a)})}}),n.extend({queue:function(a,b,c){var d;return a?(b=(b||"fx")+"queue",d=n._data(a,b),c&&(!d||n.isArray(c)?d=n._data(a,b,n.makeArray(c)):d.push(c)),d||[]):void 0},dequeue:function(a,b){b=b||"fx";var c=n.queue(a,b),d=c.length,e=c.shift(),f=n._queueHooks(a,b),g=function(){n.dequeue(a,b)};"inprogress"===e&&(e=c.shift(),d--),e&&("fx"===b&&c.unshift("inprogress"),delete f.stop,e.call(a,g,f)),!d&&f&&f.empty.fire()},_queueHooks:function(a,b){var c=b+"queueHooks";return n._data(a,c)||n._data(a,c,{empty:n.Callbacks("once memory").add(function(){n._removeData(a,b+"queue"),n._removeData(a,c)})})}}),n.fn.extend({queue:function(a,b){var c=2;return"string"!=typeof a&&(b=a,a="fx",c--),arguments.length<c?n.queue(this[0],a):void 0===b?this:this.each(function(){var c=n.queue(this,a,b);n._queueHooks(this,a),"fx"===a&&"inprogress"!==c[0]&&n.dequeue(this,a)})},dequeue:function(a){return this.each(function(){n.dequeue(this,a)})},clearQueue:function(a){return this.queue(a||"fx",[])},promise:function(a,b){var c,d=1,e=n.Deferred(),f=this,g=this.length,h=function(){--d||e.resolveWith(f,[f])};"string"!=typeof a&&(b=a,a=void 0),a=a||"fx";while(g--)c=n._data(f[g],a+"queueHooks"),c&&c.empty&&(d++,c.empty.add(h));return h(),e.promise(b)}}),function(){var a;l.shrinkWrapBlocks=function(){if(null!=a)return a;a=!1;var b,c,e;return c=d.getElementsByTagName("body")[0],c&&c.style?(b=d.createElement("div"),e=d.createElement("div"),e.style.cssText="position:absolute;border:0;width:0;height:0;top:0;left:-9999px",c.appendChild(e).appendChild(b),"undefined"!=typeof b.style.zoom&&(b.style.cssText="-webkit-box-sizing:content-box;-moz-box-sizing:content-box;box-sizing:content-box;display:block;margin:0;border:0;padding:1px;width:1px;zoom:1",b.appendChild(d.createElement("div")).style.width="5px",a=3!==b.offsetWidth),c.removeChild(e),a):void 0}}();var T=/[+-]?(?:\d*\.|)\d+(?:[eE][+-]?\d+|)/.source,U=new RegExp("^(?:([+-])=|)("+T+")([a-z%]*)$","i"),V=["Top","Right","Bottom","Left"],W=function(a,b){return a=b||a,"none"===n.css(a,"display")||!n.contains(a.ownerDocument,a)};function X(a,b,c,d){var e,f=1,g=20,h=d?function(){return d.cur()}:function(){return n.css(a,b,"")},i=h(),j=c&&c[3]||(n.cssNumber[b]?"":"px"),k=(n.cssNumber[b]||"px"!==j&&+i)&&U.exec(n.css(a,b));if(k&&k[3]!==j){j=j||k[3],c=c||[],k=+i||1;do f=f||".5",k/=f,n.style(a,b,k+j);while(f!==(f=h()/i)&&1!==f&&--g)}return c&&(k=+k||+i||0,e=c[1]?k+(c[1]+1)*c[2]:+c[2],d&&(d.unit=j,d.start=k,d.end=e)),e}var Y=function(a,b,c,d,e,f,g){var h=0,i=a.length,j=null==c;if("object"===n.type(c)){e=!0;for(h in c)Y(a,b,h,c[h],!0,f,g)}else if(void 0!==d&&(e=!0,n.isFunction(d)||(g=!0),j&&(g?(b.call(a,d),b=null):(j=b,b=function(a,b,c){return j.call(n(a),c)})),b))for(;i>h;h++)b(a[h],c,g?d:d.call(a[h],h,b(a[h],c)));return e?a:j?b.call(a):i?b(a[0],c):f},Z=/^(?:checkbox|radio)$/i,$=/<([\w:-]+)/,_=/^$|\/(?:java|ecma)script/i,aa=/^\s+/,ba="abbr|article|aside|audio|bdi|canvas|data|datalist|details|dialog|figcaption|figure|footer|header|hgroup|main|mark|meter|nav|output|picture|progress|section|summary|template|time|video";function ca(a){var b=ba.split("|"),c=a.createDocumentFragment();if(c.createElement)while(b.length)c.createElement(b.pop());return c}!function(){var a=d.createElement("div"),b=d.createDocumentFragment(),c=d.createElement("input");a.innerHTML="  <link/><table></table><a href='/a'>a</a><input type='checkbox'/>",l.leadingWhitespace=3===a.firstChild.nodeType,l.tbody=!a.getElementsByTagName("tbody").length,l.htmlSerialize=!!a.getElementsByTagName("link").length,l.html5Clone="<:nav></:nav>"!==d.createElement("nav").cloneNode(!0).outerHTML,c.type="checkbox",c.checked=!0,b.appendChild(c),l.appendChecked=c.checked,a.innerHTML="<textarea>x</textarea>",l.noCloneChecked=!!a.cloneNode(!0).lastChild.defaultValue,b.appendChild(a),c=d.createElement("input"),c.setAttribute("type","radio"),c.setAttribute("checked","checked"),c.setAttribute("name","t"),a.appendChild(c),l.checkClone=a.cloneNode(!0).cloneNode(!0).lastChild.checked,l.noCloneEvent=!!a.addEventListener,a[n.expando]=1,l.attributes=!a.getAttribute(n.expando)}();var da={option:[1,"<select multiple='multiple'>","</select>"],legend:[1,"<fieldset>","</fieldset>"],area:[1,"<map>","</map>"],param:[1,"<object>","</object>"],thead:[1,"<table>","</table>"],tr:[2,"<table><tbody>","</tbody></table>"],col:[2,"<table><tbody></tbody><colgroup>","</colgroup></table>"],td:[3,"<table><tbody><tr>","</tr></tbody></table>"],_default:l.htmlSerialize?[0,"",""]:[1,"X<div>","</div>"]};da.optgroup=da.option,da.tbody=da.tfoot=da.colgroup=da.caption=da.thead,da.th=da.td;function ea(a,b){var c,d,e=0,f="undefined"!=typeof a.getElementsByTagName?a.getElementsByTagName(b||"*"):"undefined"!=typeof a.querySelectorAll?a.querySelectorAll(b||"*"):void 0;if(!f)for(f=[],c=a.childNodes||a;null!=(d=c[e]);e++)!b||n.nodeName(d,b)?f.push(d):n.merge(f,ea(d,b));return void 0===b||b&&n.nodeName(a,b)?n.merge([a],f):f}function fa(a,b){for(var c,d=0;null!=(c=a[d]);d++)n._data(c,"globalEval",!b||n._data(b[d],"globalEval"))}var ga=/<|&#?\w+;/,ha=/<tbody/i;function ia(a){Z.test(a.type)&&(a.defaultChecked=a.checked)}function ja(a,b,c,d,e){for(var f,g,h,i,j,k,m,o=a.length,p=ca(b),q=[],r=0;o>r;r++)if(g=a[r],g||0===g)if("object"===n.type(g))n.merge(q,g.nodeType?[g]:g);else if(ga.test(g)){i=i||p.appendChild(b.createElement("div")),j=($.exec(g)||["",""])[1].toLowerCase(),m=da[j]||da._default,i.innerHTML=m[1]+n.htmlPrefilter(g)+m[2],f=m[0];while(f--)i=i.lastChild;if(!l.leadingWhitespace&&aa.test(g)&&q.push(b.createTextNode(aa.exec(g)[0])),!l.tbody){g="table"!==j||ha.test(g)?"<table>"!==m[1]||ha.test(g)?0:i:i.firstChild,f=g&&g.childNodes.length;while(f--)n.nodeName(k=g.childNodes[f],"tbody")&&!k.childNodes.length&&g.removeChild(k)}n.merge(q,i.childNodes),i.textContent="";while(i.firstChild)i.removeChild(i.firstChild);i=p.lastChild}else q.push(b.createTextNode(g));i&&p.removeChild(i),l.appendChecked||n.grep(ea(q,"input"),ia),r=0;while(g=q[r++])if(d&&n.inArray(g,d)>-1)e&&e.push(g);else if(h=n.contains(g.ownerDocument,g),i=ea(p.appendChild(g),"script"),h&&fa(i),c){f=0;while(g=i[f++])_.test(g.type||"")&&c.push(g)}return i=null,p}!function(){var b,c,e=d.createElement("div");for(b in{submit:!0,change:!0,focusin:!0})c="on"+b,(l[b]=c in a)||(e.setAttribute(c,"t"),l[b]=e.attributes[c].expando===!1);e=null}();var ka=/^(?:input|select|textarea)$/i,la=/^key/,ma=/^(?:mouse|pointer|contextmenu|drag|drop)|click/,na=/^(?:focusinfocus|focusoutblur)$/,oa=/^([^.]*)(?:\.(.+)|)/;function pa(){return!0}function qa(){return!1}function ra(){try{return d.activeElement}catch(a){}}function sa(a,b,c,d,e,f){var g,h;if("object"==typeof b){"string"!=typeof c&&(d=d||c,c=void 0);for(h in b)sa(a,h,c,d,b[h],f);return a}if(null==d&&null==e?(e=c,d=c=void 0):null==e&&("string"==typeof c?(e=d,d=void 0):(e=d,d=c,c=void 0)),e===!1)e=qa;else if(!e)return a;return 1===f&&(g=e,e=function(a){return n().off(a),g.apply(this,arguments)},e.guid=g.guid||(g.guid=n.guid++)),a.each(function(){n.event.add(this,b,e,d,c)})}n.event={global:{},add:function(a,b,c,d,e){var f,g,h,i,j,k,l,m,o,p,q,r=n._data(a);if(r){c.handler&&(i=c,c=i.handler,e=i.selector),c.guid||(c.guid=n.guid++),(g=r.events)||(g=r.events={}),(k=r.handle)||(k=r.handle=function(a){return"undefined"==typeof n||a&&n.event.triggered===a.type?void 0:n.event.dispatch.apply(k.elem,arguments)},k.elem=a),b=(b||"").match(G)||[""],h=b.length;while(h--)f=oa.exec(b[h])||[],o=q=f[1],p=(f[2]||"").split(".").sort(),o&&(j=n.event.special[o]||{},o=(e?j.delegateType:j.bindType)||o,j=n.event.special[o]||{},l=n.extend({type:o,origType:q,data:d,handler:c,guid:c.guid,selector:e,needsContext:e&&n.expr.match.needsContext.test(e),namespace:p.join(".")},i),(m=g[o])||(m=g[o]=[],m.delegateCount=0,j.setup&&j.setup.call(a,d,p,k)!==!1||(a.addEventListener?a.addEventListener(o,k,!1):a.attachEvent&&a.attachEvent("on"+o,k))),j.add&&(j.add.call(a,l),l.handler.guid||(l.handler.guid=c.guid)),e?m.splice(m.delegateCount++,0,l):m.push(l),n.event.global[o]=!0);a=null}},remove:function(a,b,c,d,e){var f,g,h,i,j,k,l,m,o,p,q,r=n.hasData(a)&&n._data(a);if(r&&(k=r.events)){b=(b||"").match(G)||[""],j=b.length;while(j--)if(h=oa.exec(b[j])||[],o=q=h[1],p=(h[2]||"").split(".").sort(),o){l=n.event.special[o]||{},o=(d?l.delegateType:l.bindType)||o,m=k[o]||[],h=h[2]&&new RegExp("(^|\\.)"+p.join("\\.(?:.*\\.|)")+"(\\.|$)"),i=f=m.length;while(f--)g=m[f],!e&&q!==g.origType||c&&c.guid!==g.guid||h&&!h.test(g.namespace)||d&&d!==g.selector&&("**"!==d||!g.selector)||(m.splice(f,1),g.selector&&m.delegateCount--,l.remove&&l.remove.call(a,g));i&&!m.length&&(l.teardown&&l.teardown.call(a,p,r.handle)!==!1||n.removeEvent(a,o,r.handle),delete k[o])}else for(o in k)n.event.remove(a,o+b[j],c,d,!0);n.isEmptyObject(k)&&(delete r.handle,n._removeData(a,"events"))}},trigger:function(b,c,e,f){var g,h,i,j,l,m,o,p=[e||d],q=k.call(b,"type")?b.type:b,r=k.call(b,"namespace")?b.namespace.split("."):[];if(i=m=e=e||d,3!==e.nodeType&&8!==e.nodeType&&!na.test(q+n.event.triggered)&&(q.indexOf(".")>-1&&(r=q.split("."),q=r.shift(),r.sort()),h=q.indexOf(":")<0&&"on"+q,b=b[n.expando]?b:new n.Event(q,"object"==typeof b&&b),b.isTrigger=f?2:3,b.namespace=r.join("."),b.rnamespace=b.namespace?new RegExp("(^|\\.)"+r.join("\\.(?:.*\\.|)")+"(\\.|$)"):null,b.result=void 0,b.target||(b.target=e),c=null==c?[b]:n.makeArray(c,[b]),l=n.event.special[q]||{},f||!l.trigger||l.trigger.apply(e,c)!==!1)){if(!f&&!l.noBubble&&!n.isWindow(e)){for(j=l.delegateType||q,na.test(j+q)||(i=i.parentNode);i;i=i.parentNode)p.push(i),m=i;m===(e.ownerDocument||d)&&p.push(m.defaultView||m.parentWindow||a)}o=0;while((i=p[o++])&&!b.isPropagationStopped())b.type=o>1?j:l.bindType||q,g=(n._data(i,"events")||{})[b.type]&&n._data(i,"handle"),g&&g.apply(i,c),g=h&&i[h],g&&g.apply&&M(i)&&(b.result=g.apply(i,c),b.result===!1&&b.preventDefault());if(b.type=q,!f&&!b.isDefaultPrevented()&&(!l._default||l._default.apply(p.pop(),c)===!1)&&M(e)&&h&&e[q]&&!n.isWindow(e)){m=e[h],m&&(e[h]=null),n.event.triggered=q;try{e[q]()}catch(s){}n.event.triggered=void 0,m&&(e[h]=m)}return b.result}},dispatch:function(a){a=n.event.fix(a);var b,c,d,f,g,h=[],i=e.call(arguments),j=(n._data(this,"events")||{})[a.type]||[],k=n.event.special[a.type]||{};if(i[0]=a,a.delegateTarget=this,!k.preDispatch||k.preDispatch.call(this,a)!==!1){h=n.event.handlers.call(this,a,j),b=0;while((f=h[b++])&&!a.isPropagationStopped()){a.currentTarget=f.elem,c=0;while((g=f.handlers[c++])&&!a.isImmediatePropagationStopped())a.rnamespace&&!a.rnamespace.test(g.namespace)||(a.handleObj=g,a.data=g.data,d=((n.event.special[g.origType]||{}).handle||g.handler).apply(f.elem,i),void 0!==d&&(a.result=d)===!1&&(a.preventDefault(),a.stopPropagation()))}return k.postDispatch&&k.postDispatch.call(this,a),a.result}},handlers:function(a,b){var c,d,e,f,g=[],h=b.delegateCount,i=a.target;if(h&&i.nodeType&&("click"!==a.type||isNaN(a.button)||a.button<1))for(;i!=this;i=i.parentNode||this)if(1===i.nodeType&&(i.disabled!==!0||"click"!==a.type)){for(d=[],c=0;h>c;c++)f=b[c],e=f.selector+" ",void 0===d[e]&&(d[e]=f.needsContext?n(e,this).index(i)>-1:n.find(e,this,null,[i]).length),d[e]&&d.push(f);d.length&&g.push({elem:i,handlers:d})}return h<b.length&&g.push({elem:this,handlers:b.slice(h)}),g},fix:function(a){if(a[n.expando])return a;var b,c,e,f=a.type,g=a,h=this.fixHooks[f];h||(this.fixHooks[f]=h=ma.test(f)?this.mouseHooks:la.test(f)?this.keyHooks:{}),e=h.props?this.props.concat(h.props):this.props,a=new n.Event(g),b=e.length;while(b--)c=e[b],a[c]=g[c];return a.target||(a.target=g.srcElement||d),3===a.target.nodeType&&(a.target=a.target.parentNode),a.metaKey=!!a.metaKey,h.filter?h.filter(a,g):a},props:"altKey bubbles cancelable ctrlKey currentTarget detail eventPhase metaKey relatedTarget shiftKey target timeStamp view which".split(" "),fixHooks:{},keyHooks:{props:"char charCode key keyCode".split(" "),filter:function(a,b){return null==a.which&&(a.which=null!=b.charCode?b.charCode:b.keyCode),a}},mouseHooks:{props:"button buttons clientX clientY fromElement offsetX offsetY pageX pageY screenX screenY toElement".split(" "),filter:function(a,b){var c,e,f,g=b.button,h=b.fromElement;return null==a.pageX&&null!=b.clientX&&(e=a.target.ownerDocument||d,f=e.documentElement,c=e.body,a.pageX=b.clientX+(f&&f.scrollLeft||c&&c.scrollLeft||0)-(f&&f.clientLeft||c&&c.clientLeft||0),a.pageY=b.clientY+(f&&f.scrollTop||c&&c.scrollTop||0)-(f&&f.clientTop||c&&c.clientTop||0)),!a.relatedTarget&&h&&(a.relatedTarget=h===a.target?b.toElement:h),a.which||void 0===g||(a.which=1&g?1:2&g?3:4&g?2:0),a}},special:{load:{noBubble:!0},focus:{trigger:function(){if(this!==ra()&&this.focus)try{return this.focus(),!1}catch(a){}},delegateType:"focusin"},blur:{trigger:function(){return this===ra()&&this.blur?(this.blur(),!1):void 0},delegateType:"focusout"},click:{trigger:function(){return n.nodeName(this,"input")&&"checkbox"===this.type&&this.click?(this.click(),!1):void 0},_default:function(a){return n.nodeName(a.target,"a")}},beforeunload:{postDispatch:function(a){void 0!==a.result&&a.originalEvent&&(a.originalEvent.returnValue=a.result)}}},simulate:function(a,b,c){var d=n.extend(new n.Event,c,{type:a,isSimulated:!0});n.event.trigger(d,null,b),d.isDefaultPrevented()&&c.preventDefault()}},n.removeEvent=d.removeEventListener?function(a,b,c){a.removeEventListener&&a.removeEventListener(b,c)}:function(a,b,c){var d="on"+b;a.detachEvent&&("undefined"==typeof a[d]&&(a[d]=null),a.detachEvent(d,c))},n.Event=function(a,b){return this instanceof n.Event?(a&&a.type?(this.originalEvent=a,this.type=a.type,this.isDefaultPrevented=a.defaultPrevented||void 0===a.defaultPrevented&&a.returnValue===!1?pa:qa):this.type=a,b&&n.extend(this,b),this.timeStamp=a&&a.timeStamp||n.now(),void(this[n.expando]=!0)):new n.Event(a,b)},n.Event.prototype={constructor:n.Event,isDefaultPrevented:qa,isPropagationStopped:qa,isImmediatePropagationStopped:qa,preventDefault:function(){var a=this.originalEvent;this.isDefaultPrevented=pa,a&&(a.preventDefault?a.preventDefault():a.returnValue=!1)},stopPropagation:function(){var a=this.originalEvent;this.isPropagationStopped=pa,a&&!this.isSimulated&&(a.stopPropagation&&a.stopPropagation(),a.cancelBubble=!0)},stopImmediatePropagation:function(){var a=this.originalEvent;this.isImmediatePropagationStopped=pa,a&&a.stopImmediatePropagation&&a.stopImmediatePropagation(),this.stopPropagation()}},n.each({mouseenter:"mouseover",mouseleave:"mouseout",pointerenter:"pointerover",pointerleave:"pointerout"},function(a,b){n.event.special[a]={delegateType:b,bindType:b,handle:function(a){var c,d=this,e=a.relatedTarget,f=a.handleObj;return e&&(e===d||n.contains(d,e))||(a.type=f.origType,c=f.handler.apply(this,arguments),a.type=b),c}}}),l.submit||(n.event.special.submit={setup:function(){return n.nodeName(this,"form")?!1:void n.event.add(this,"click._submit keypress._submit",function(a){var b=a.target,c=n.nodeName(b,"input")||n.nodeName(b,"button")?n.prop(b,"form"):void 0;c&&!n._data(c,"submit")&&(n.event.add(c,"submit._submit",function(a){a._submitBubble=!0}),n._data(c,"submit",!0))})},postDispatch:function(a){a._submitBubble&&(delete a._submitBubble,this.parentNode&&!a.isTrigger&&n.event.simulate("submit",this.parentNode,a))},teardown:function(){return n.nodeName(this,"form")?!1:void n.event.remove(this,"._submit")}}),l.change||(n.event.special.change={setup:function(){return ka.test(this.nodeName)?("checkbox"!==this.type&&"radio"!==this.type||(n.event.add(this,"propertychange._change",function(a){"checked"===a.originalEvent.propertyName&&(this._justChanged=!0)}),n.event.add(this,"click._change",function(a){this._justChanged&&!a.isTrigger&&(this._justChanged=!1),n.event.simulate("change",this,a)})),!1):void n.event.add(this,"beforeactivate._change",function(a){var b=a.target;ka.test(b.nodeName)&&!n._data(b,"change")&&(n.event.add(b,"change._change",function(a){!this.parentNode||a.isSimulated||a.isTrigger||n.event.simulate("change",this.parentNode,a)}),n._data(b,"change",!0))})},handle:function(a){var b=a.target;return this!==b||a.isSimulated||a.isTrigger||"radio"!==b.type&&"checkbox"!==b.type?a.handleObj.handler.apply(this,arguments):void 0},teardown:function(){return n.event.remove(this,"._change"),!ka.test(this.nodeName)}}),l.focusin||n.each({focus:"focusin",blur:"focusout"},function(a,b){var c=function(a){n.event.simulate(b,a.target,n.event.fix(a))};n.event.special[b]={setup:function(){var d=this.ownerDocument||this,e=n._data(d,b);e||d.addEventListener(a,c,!0),n._data(d,b,(e||0)+1)},teardown:function(){var d=this.ownerDocument||this,e=n._data(d,b)-1;e?n._data(d,b,e):(d.removeEventListener(a,c,!0),n._removeData(d,b))}}}),n.fn.extend({on:function(a,b,c,d){return sa(this,a,b,c,d)},one:function(a,b,c,d){return sa(this,a,b,c,d,1)},off:function(a,b,c){var d,e;if(a&&a.preventDefault&&a.handleObj)return d=a.handleObj,n(a.delegateTarget).off(d.namespace?d.origType+"."+d.namespace:d.origType,d.selector,d.handler),this;if("object"==typeof a){for(e in a)this.off(e,b,a[e]);return this}return b!==!1&&"function"!=typeof b||(c=b,b=void 0),c===!1&&(c=qa),this.each(function(){n.event.remove(this,a,c,b)})},trigger:function(a,b){return this.each(function(){n.event.trigger(a,b,this)})},triggerHandler:function(a,b){var c=this[0];return c?n.event.trigger(a,b,c,!0):void 0}});var ta=/ jQuery\d+="(?:null|\d+)"/g,ua=new RegExp("<(?:"+ba+")[\\s/>]","i"),va=/<(?!area|br|col|embed|hr|img|input|link|meta|param)(([\w:-]+)[^>]*)\/>/gi,wa=/<script|<style|<link/i,xa=/checked\s*(?:[^=]|=\s*.checked.)/i,ya=/^true\/(.*)/,za=/^\s*<!(?:\[CDATA\[|--)|(?:\]\]|--)>\s*$/g,Aa=ca(d),Ba=Aa.appendChild(d.createElement("div"));function Ca(a,b){return n.nodeName(a,"table")&&n.nodeName(11!==b.nodeType?b:b.firstChild,"tr")?a.getElementsByTagName("tbody")[0]||a.appendChild(a.ownerDocument.createElement("tbody")):a}function Da(a){return a.type=(null!==n.find.attr(a,"type"))+"/"+a.type,a}function Ea(a){var b=ya.exec(a.type);return b?a.type=b[1]:a.removeAttribute("type"),a}function Fa(a,b){if(1===b.nodeType&&n.hasData(a)){var c,d,e,f=n._data(a),g=n._data(b,f),h=f.events;if(h){delete g.handle,g.events={};for(c in h)for(d=0,e=h[c].length;e>d;d++)n.event.add(b,c,h[c][d])}g.data&&(g.data=n.extend({},g.data))}}function Ga(a,b){var c,d,e;if(1===b.nodeType){if(c=b.nodeName.toLowerCase(),!l.noCloneEvent&&b[n.expando]){e=n._data(b);for(d in e.events)n.removeEvent(b,d,e.handle);b.removeAttribute(n.expando)}"script"===c&&b.text!==a.text?(Da(b).text=a.text,Ea(b)):"object"===c?(b.parentNode&&(b.outerHTML=a.outerHTML),l.html5Clone&&a.innerHTML&&!n.trim(b.innerHTML)&&(b.innerHTML=a.innerHTML)):"input"===c&&Z.test(a.type)?(b.defaultChecked=b.checked=a.checked,b.value!==a.value&&(b.value=a.value)):"option"===c?b.defaultSelected=b.selected=a.defaultSelected:"input"!==c&&"textarea"!==c||(b.defaultValue=a.defaultValue)}}function Ha(a,b,c,d){b=f.apply([],b);var e,g,h,i,j,k,m=0,o=a.length,p=o-1,q=b[0],r=n.isFunction(q);if(r||o>1&&"string"==typeof q&&!l.checkClone&&xa.test(q))return a.each(function(e){var f=a.eq(e);r&&(b[0]=q.call(this,e,f.html())),Ha(f,b,c,d)});if(o&&(k=ja(b,a[0].ownerDocument,!1,a,d),e=k.firstChild,1===k.childNodes.length&&(k=e),e||d)){for(i=n.map(ea(k,"script"),Da),h=i.length;o>m;m++)g=k,m!==p&&(g=n.clone(g,!0,!0),h&&n.merge(i,ea(g,"script"))),c.call(a[m],g,m);if(h)for(j=i[i.length-1].ownerDocument,n.map(i,Ea),m=0;h>m;m++)g=i[m],_.test(g.type||"")&&!n._data(g,"globalEval")&&n.contains(j,g)&&(g.src?n._evalUrl&&n._evalUrl(g.src):n.globalEval((g.text||g.textContent||g.innerHTML||"").replace(za,"")));k=e=null}return a}function Ia(a,b,c){for(var d,e=b?n.filter(b,a):a,f=0;null!=(d=e[f]);f++)c||1!==d.nodeType||n.cleanData(ea(d)),d.parentNode&&(c&&n.contains(d.ownerDocument,d)&&fa(ea(d,"script")),d.parentNode.removeChild(d));return a}n.extend({htmlPrefilter:function(a){return a.replace(va,"<$1></$2>")},clone:function(a,b,c){var d,e,f,g,h,i=n.contains(a.ownerDocument,a);if(l.html5Clone||n.isXMLDoc(a)||!ua.test("<"+a.nodeName+">")?f=a.cloneNode(!0):(Ba.innerHTML=a.outerHTML,Ba.removeChild(f=Ba.firstChild)),!(l.noCloneEvent&&l.noCloneChecked||1!==a.nodeType&&11!==a.nodeType||n.isXMLDoc(a)))for(d=ea(f),h=ea(a),g=0;null!=(e=h[g]);++g)d[g]&&Ga(e,d[g]);if(b)if(c)for(h=h||ea(a),d=d||ea(f),g=0;null!=(e=h[g]);g++)Fa(e,d[g]);else Fa(a,f);return d=ea(f,"script"),d.length>0&&fa(d,!i&&ea(a,"script")),d=h=e=null,f},cleanData:function(a,b){for(var d,e,f,g,h=0,i=n.expando,j=n.cache,k=l.attributes,m=n.event.special;null!=(d=a[h]);h++)if((b||M(d))&&(f=d[i],g=f&&j[f])){if(g.events)for(e in g.events)m[e]?n.event.remove(d,e):n.removeEvent(d,e,g.handle);j[f]&&(delete j[f],k||"undefined"==typeof d.removeAttribute?d[i]=void 0:d.removeAttribute(i),c.push(f))}}}),n.fn.extend({domManip:Ha,detach:function(a){return Ia(this,a,!0)},remove:function(a){return Ia(this,a)},text:function(a){return Y(this,function(a){return void 0===a?n.text(this):this.empty().append((this[0]&&this[0].ownerDocument||d).createTextNode(a))},null,a,arguments.length)},append:function(){return Ha(this,arguments,function(a){if(1===this.nodeType||11===this.nodeType||9===this.nodeType){var b=Ca(this,a);b.appendChild(a)}})},prepend:function(){return Ha(this,arguments,function(a){if(1===this.nodeType||11===this.nodeType||9===this.nodeType){var b=Ca(this,a);b.insertBefore(a,b.firstChild)}})},before:function(){return Ha(this,arguments,function(a){this.parentNode&&this.parentNode.insertBefore(a,this)})},after:function(){return Ha(this,arguments,function(a){this.parentNode&&this.parentNode.insertBefore(a,this.nextSibling)})},empty:function(){for(var a,b=0;null!=(a=this[b]);b++){1===a.nodeType&&n.cleanData(ea(a,!1));while(a.firstChild)a.removeChild(a.firstChild);a.options&&n.nodeName(a,"select")&&(a.options.length=0)}return this},clone:function(a,b){return a=null==a?!1:a,b=null==b?a:b,this.map(function(){return n.clone(this,a,b)})},html:function(a){return Y(this,function(a){var b=this[0]||{},c=0,d=this.length;if(void 0===a)return 1===b.nodeType?b.innerHTML.replace(ta,""):void 0;if("string"==typeof a&&!wa.test(a)&&(l.htmlSerialize||!ua.test(a))&&(l.leadingWhitespace||!aa.test(a))&&!da[($.exec(a)||["",""])[1].toLowerCase()]){a=n.htmlPrefilter(a);try{for(;d>c;c++)b=this[c]||{},1===b.nodeType&&(n.cleanData(ea(b,!1)),b.innerHTML=a);b=0}catch(e){}}b&&this.empty().append(a)},null,a,arguments.length)},replaceWith:function(){var a=[];return Ha(this,arguments,function(b){var c=this.parentNode;n.inArray(this,a)<0&&(n.cleanData(ea(this)),c&&c.replaceChild(b,this))},a)}}),n.each({appendTo:"append",prependTo:"prepend",insertBefore:"before",insertAfter:"after",replaceAll:"replaceWith"},function(a,b){n.fn[a]=function(a){for(var c,d=0,e=[],f=n(a),h=f.length-1;h>=d;d++)c=d===h?this:this.clone(!0),n(f[d])[b](c),g.apply(e,c.get());return this.pushStack(e)}});var Ja,Ka={HTML:"block",BODY:"block"};function La(a,b){var c=n(b.createElement(a)).appendTo(b.body),d=n.css(c[0],"display");return c.detach(),d}function Ma(a){var b=d,c=Ka[a];return c||(c=La(a,b),"none"!==c&&c||(Ja=(Ja||n("<iframe frameborder='0' width='0' height='0'/>")).appendTo(b.documentElement),b=(Ja[0].contentWindow||Ja[0].contentDocument).document,b.write(),b.close(),c=La(a,b),Ja.detach()),Ka[a]=c),c}var Na=/^margin/,Oa=new RegExp("^("+T+")(?!px)[a-z%]+$","i"),Pa=function(a,b,c,d){var e,f,g={};for(f in b)g[f]=a.style[f],a.style[f]=b[f];e=c.apply(a,d||[]);for(f in b)a.style[f]=g[f];return e},Qa=d.documentElement;!function(){var b,c,e,f,g,h,i=d.createElement("div"),j=d.createElement("div");if(j.style){j.style.cssText="float:left;opacity:.5",l.opacity="0.5"===j.style.opacity,l.cssFloat=!!j.style.cssFloat,j.style.backgroundClip="content-box",j.cloneNode(!0).style.backgroundClip="",l.clearCloneStyle="content-box"===j.style.backgroundClip,i=d.createElement("div"),i.style.cssText="border:0;width:8px;height:0;top:0;left:-9999px;padding:0;margin-top:1px;position:absolute",j.innerHTML="",i.appendChild(j),l.boxSizing=""===j.style.boxSizing||""===j.style.MozBoxSizing||""===j.style.WebkitBoxSizing,n.extend(l,{reliableHiddenOffsets:function(){return null==b&&k(),f},boxSizingReliable:function(){return null==b&&k(),e},pixelMarginRight:function(){return null==b&&k(),c},pixelPosition:function(){return null==b&&k(),b},reliableMarginRight:function(){return null==b&&k(),g},reliableMarginLeft:function(){return null==b&&k(),h}});function k(){var k,l,m=d.documentElement;m.appendChild(i),j.style.cssText="-webkit-box-sizing:border-box;box-sizing:border-box;position:relative;display:block;margin:auto;border:1px;padding:1px;top:1%;width:50%",b=e=h=!1,c=g=!0,a.getComputedStyle&&(l=a.getComputedStyle(j),b="1%"!==(l||{}).top,h="2px"===(l||{}).marginLeft,e="4px"===(l||{width:"4px"}).width,j.style.marginRight="50%",c="4px"===(l||{marginRight:"4px"}).marginRight,k=j.appendChild(d.createElement("div")),k.style.cssText=j.style.cssText="-webkit-box-sizing:content-box;-moz-box-sizing:content-box;box-sizing:content-box;display:block;margin:0;border:0;padding:0",k.style.marginRight=k.style.width="0",j.style.width="1px",g=!parseFloat((a.getComputedStyle(k)||{}).marginRight),j.removeChild(k)),j.style.display="none",f=0===j.getClientRects().length,f&&(j.style.display="",j.innerHTML="<table><tr><td></td><td>t</td></tr></table>",j.childNodes[0].style.borderCollapse="separate",k=j.getElementsByTagName("td"),k[0].style.cssText="margin:0;border:0;padding:0;display:none",f=0===k[0].offsetHeight,f&&(k[0].style.display="",k[1].style.display="none",f=0===k[0].offsetHeight)),m.removeChild(i)}}}();var Ra,Sa,Ta=/^(top|right|bottom|left)$/;a.getComputedStyle?(Ra=function(b){var c=b.ownerDocument.defaultView;return c&&c.opener||(c=a),c.getComputedStyle(b)},Sa=function(a,b,c){var d,e,f,g,h=a.style;return c=c||Ra(a),g=c?c.getPropertyValue(b)||c[b]:void 0,""!==g&&void 0!==g||n.contains(a.ownerDocument,a)||(g=n.style(a,b)),c&&!l.pixelMarginRight()&&Oa.test(g)&&Na.test(b)&&(d=h.width,e=h.minWidth,f=h.maxWidth,h.minWidth=h.maxWidth=h.width=g,g=c.width,h.width=d,h.minWidth=e,h.maxWidth=f),void 0===g?g:g+""}):Qa.currentStyle&&(Ra=function(a){return a.currentStyle},Sa=function(a,b,c){var d,e,f,g,h=a.style;return c=c||Ra(a),g=c?c[b]:void 0,null==g&&h&&h[b]&&(g=h[b]),Oa.test(g)&&!Ta.test(b)&&(d=h.left,e=a.runtimeStyle,f=e&&e.left,f&&(e.left=a.currentStyle.left),h.left="fontSize"===b?"1em":g,g=h.pixelLeft+"px",h.left=d,f&&(e.left=f)),void 0===g?g:g+""||"auto"});function Ua(a,b){return{get:function(){return a()?void delete this.get:(this.get=b).apply(this,arguments)}}}var Va=/alpha\([^)]*\)/i,Wa=/opacity\s*=\s*([^)]*)/i,Xa=/^(none|table(?!-c[ea]).+)/,Ya=new RegExp("^("+T+")(.*)$","i"),Za={position:"absolute",visibility:"hidden",display:"block"},$a={letterSpacing:"0",fontWeight:"400"},_a=["Webkit","O","Moz","ms"],ab=d.createElement("div").style;function bb(a){if(a in ab)return a;var b=a.charAt(0).toUpperCase()+a.slice(1),c=_a.length;while(c--)if(a=_a[c]+b,a in ab)return a}function cb(a,b){for(var c,d,e,f=[],g=0,h=a.length;h>g;g++)d=a[g],d.style&&(f[g]=n._data(d,"olddisplay"),c=d.style.display,b?(f[g]||"none"!==c||(d.style.display=""),""===d.style.display&&W(d)&&(f[g]=n._data(d,"olddisplay",Ma(d.nodeName)))):(e=W(d),(c&&"none"!==c||!e)&&n._data(d,"olddisplay",e?c:n.css(d,"display"))));for(g=0;h>g;g++)d=a[g],d.style&&(b&&"none"!==d.style.display&&""!==d.style.display||(d.style.display=b?f[g]||"":"none"));return a}function db(a,b,c){var d=Ya.exec(b);return d?Math.max(0,d[1]-(c||0))+(d[2]||"px"):b}function eb(a,b,c,d,e){for(var f=c===(d?"border":"content")?4:"width"===b?1:0,g=0;4>f;f+=2)"margin"===c&&(g+=n.css(a,c+V[f],!0,e)),d?("content"===c&&(g-=n.css(a,"padding"+V[f],!0,e)),"margin"!==c&&(g-=n.css(a,"border"+V[f]+"Width",!0,e))):(g+=n.css(a,"padding"+V[f],!0,e),"padding"!==c&&(g+=n.css(a,"border"+V[f]+"Width",!0,e)));return g}function fb(a,b,c){var d=!0,e="width"===b?a.offsetWidth:a.offsetHeight,f=Ra(a),g=l.boxSizing&&"border-box"===n.css(a,"boxSizing",!1,f);if(0>=e||null==e){if(e=Sa(a,b,f),(0>e||null==e)&&(e=a.style[b]),Oa.test(e))return e;d=g&&(l.boxSizingReliable()||e===a.style[b]),e=parseFloat(e)||0}return e+eb(a,b,c||(g?"border":"content"),d,f)+"px"}n.extend({cssHooks:{opacity:{get:function(a,b){if(b){var c=Sa(a,"opacity");return""===c?"1":c}}}},cssNumber:{animationIterationCount:!0,columnCount:!0,fillOpacity:!0,flexGrow:!0,flexShrink:!0,fontWeight:!0,lineHeight:!0,opacity:!0,order:!0,orphans:!0,widows:!0,zIndex:!0,zoom:!0},cssProps:{"float":l.cssFloat?"cssFloat":"styleFloat"},style:function(a,b,c,d){if(a&&3!==a.nodeType&&8!==a.nodeType&&a.style){var e,f,g,h=n.camelCase(b),i=a.style;if(b=n.cssProps[h]||(n.cssProps[h]=bb(h)||h),g=n.cssHooks[b]||n.cssHooks[h],void 0===c)return g&&"get"in g&&void 0!==(e=g.get(a,!1,d))?e:i[b];if(f=typeof c,"string"===f&&(e=U.exec(c))&&e[1]&&(c=X(a,b,e),f="number"),null!=c&&c===c&&("number"===f&&(c+=e&&e[3]||(n.cssNumber[h]?"":"px")),l.clearCloneStyle||""!==c||0!==b.indexOf("background")||(i[b]="inherit"),!(g&&"set"in g&&void 0===(c=g.set(a,c,d)))))try{i[b]=c}catch(j){}}},css:function(a,b,c,d){var e,f,g,h=n.camelCase(b);return b=n.cssProps[h]||(n.cssProps[h]=bb(h)||h),g=n.cssHooks[b]||n.cssHooks[h],g&&"get"in g&&(f=g.get(a,!0,c)),void 0===f&&(f=Sa(a,b,d)),"normal"===f&&b in $a&&(f=$a[b]),""===c||c?(e=parseFloat(f),c===!0||isFinite(e)?e||0:f):f}}),n.each(["height","width"],function(a,b){n.cssHooks[b]={get:function(a,c,d){return c?Xa.test(n.css(a,"display"))&&0===a.offsetWidth?Pa(a,Za,function(){return fb(a,b,d)}):fb(a,b,d):void 0},set:function(a,c,d){var e=d&&Ra(a);return db(a,c,d?eb(a,b,d,l.boxSizing&&"border-box"===n.css(a,"boxSizing",!1,e),e):0)}}}),l.opacity||(n.cssHooks.opacity={get:function(a,b){return Wa.test((b&&a.currentStyle?a.currentStyle.filter:a.style.filter)||"")?.01*parseFloat(RegExp.$1)+"":b?"1":""},set:function(a,b){var c=a.style,d=a.currentStyle,e=n.isNumeric(b)?"alpha(opacity="+100*b+")":"",f=d&&d.filter||c.filter||"";c.zoom=1,(b>=1||""===b)&&""===n.trim(f.replace(Va,""))&&c.removeAttribute&&(c.removeAttribute("filter"),""===b||d&&!d.filter)||(c.filter=Va.test(f)?f.replace(Va,e):f+" "+e)}}),n.cssHooks.marginRight=Ua(l.reliableMarginRight,function(a,b){return b?Pa(a,{display:"inline-block"},Sa,[a,"marginRight"]):void 0}),n.cssHooks.marginLeft=Ua(l.reliableMarginLeft,function(a,b){return b?(parseFloat(Sa(a,"marginLeft"))||(n.contains(a.ownerDocument,a)?a.getBoundingClientRect().left-Pa(a,{
    marginLeft:0},function(){return a.getBoundingClientRect().left}):0))+"px":void 0}),n.each({margin:"",padding:"",border:"Width"},function(a,b){n.cssHooks[a+b]={expand:function(c){for(var d=0,e={},f="string"==typeof c?c.split(" "):[c];4>d;d++)e[a+V[d]+b]=f[d]||f[d-2]||f[0];return e}},Na.test(a)||(n.cssHooks[a+b].set=db)}),n.fn.extend({css:function(a,b){return Y(this,function(a,b,c){var d,e,f={},g=0;if(n.isArray(b)){for(d=Ra(a),e=b.length;e>g;g++)f[b[g]]=n.css(a,b[g],!1,d);return f}return void 0!==c?n.style(a,b,c):n.css(a,b)},a,b,arguments.length>1)},show:function(){return cb(this,!0)},hide:function(){return cb(this)},toggle:function(a){return"boolean"==typeof a?a?this.show():this.hide():this.each(function(){W(this)?n(this).show():n(this).hide()})}});function gb(a,b,c,d,e){return new gb.prototype.init(a,b,c,d,e)}n.Tween=gb,gb.prototype={constructor:gb,init:function(a,b,c,d,e,f){this.elem=a,this.prop=c,this.easing=e||n.easing._default,this.options=b,this.start=this.now=this.cur(),this.end=d,this.unit=f||(n.cssNumber[c]?"":"px")},cur:function(){var a=gb.propHooks[this.prop];return a&&a.get?a.get(this):gb.propHooks._default.get(this)},run:function(a){var b,c=gb.propHooks[this.prop];return this.options.duration?this.pos=b=n.easing[this.easing](a,this.options.duration*a,0,1,this.options.duration):this.pos=b=a,this.now=(this.end-this.start)*b+this.start,this.options.step&&this.options.step.call(this.elem,this.now,this),c&&c.set?c.set(this):gb.propHooks._default.set(this),this}},gb.prototype.init.prototype=gb.prototype,gb.propHooks={_default:{get:function(a){var b;return 1!==a.elem.nodeType||null!=a.elem[a.prop]&&null==a.elem.style[a.prop]?a.elem[a.prop]:(b=n.css(a.elem,a.prop,""),b&&"auto"!==b?b:0)},set:function(a){n.fx.step[a.prop]?n.fx.step[a.prop](a):1!==a.elem.nodeType||null==a.elem.style[n.cssProps[a.prop]]&&!n.cssHooks[a.prop]?a.elem[a.prop]=a.now:n.style(a.elem,a.prop,a.now+a.unit)}}},gb.propHooks.scrollTop=gb.propHooks.scrollLeft={set:function(a){a.elem.nodeType&&a.elem.parentNode&&(a.elem[a.prop]=a.now)}},n.easing={linear:function(a){return a},swing:function(a){return.5-Math.cos(a*Math.PI)/2},_default:"swing"},n.fx=gb.prototype.init,n.fx.step={};var hb,ib,jb=/^(?:toggle|show|hide)$/,kb=/queueHooks$/;function lb(){return a.setTimeout(function(){hb=void 0}),hb=n.now()}function mb(a,b){var c,d={height:a},e=0;for(b=b?1:0;4>e;e+=2-b)c=V[e],d["margin"+c]=d["padding"+c]=a;return b&&(d.opacity=d.width=a),d}function nb(a,b,c){for(var d,e=(qb.tweeners[b]||[]).concat(qb.tweeners["*"]),f=0,g=e.length;g>f;f++)if(d=e[f].call(c,b,a))return d}function ob(a,b,c){var d,e,f,g,h,i,j,k,m=this,o={},p=a.style,q=a.nodeType&&W(a),r=n._data(a,"fxshow");c.queue||(h=n._queueHooks(a,"fx"),null==h.unqueued&&(h.unqueued=0,i=h.empty.fire,h.empty.fire=function(){h.unqueued||i()}),h.unqueued++,m.always(function(){m.always(function(){h.unqueued--,n.queue(a,"fx").length||h.empty.fire()})})),1===a.nodeType&&("height"in b||"width"in b)&&(c.overflow=[p.overflow,p.overflowX,p.overflowY],j=n.css(a,"display"),k="none"===j?n._data(a,"olddisplay")||Ma(a.nodeName):j,"inline"===k&&"none"===n.css(a,"float")&&(l.inlineBlockNeedsLayout&&"inline"!==Ma(a.nodeName)?p.zoom=1:p.display="inline-block")),c.overflow&&(p.overflow="hidden",l.shrinkWrapBlocks()||m.always(function(){p.overflow=c.overflow[0],p.overflowX=c.overflow[1],p.overflowY=c.overflow[2]}));for(d in b)if(e=b[d],jb.exec(e)){if(delete b[d],f=f||"toggle"===e,e===(q?"hide":"show")){if("show"!==e||!r||void 0===r[d])continue;q=!0}o[d]=r&&r[d]||n.style(a,d)}else j=void 0;if(n.isEmptyObject(o))"inline"===("none"===j?Ma(a.nodeName):j)&&(p.display=j);else{r?"hidden"in r&&(q=r.hidden):r=n._data(a,"fxshow",{}),f&&(r.hidden=!q),q?n(a).show():m.done(function(){n(a).hide()}),m.done(function(){var b;n._removeData(a,"fxshow");for(b in o)n.style(a,b,o[b])});for(d in o)g=nb(q?r[d]:0,d,m),d in r||(r[d]=g.start,q&&(g.end=g.start,g.start="width"===d||"height"===d?1:0))}}function pb(a,b){var c,d,e,f,g;for(c in a)if(d=n.camelCase(c),e=b[d],f=a[c],n.isArray(f)&&(e=f[1],f=a[c]=f[0]),c!==d&&(a[d]=f,delete a[c]),g=n.cssHooks[d],g&&"expand"in g){f=g.expand(f),delete a[d];for(c in f)c in a||(a[c]=f[c],b[c]=e)}else b[d]=e}function qb(a,b,c){var d,e,f=0,g=qb.prefilters.length,h=n.Deferred().always(function(){delete i.elem}),i=function(){if(e)return!1;for(var b=hb||lb(),c=Math.max(0,j.startTime+j.duration-b),d=c/j.duration||0,f=1-d,g=0,i=j.tweens.length;i>g;g++)j.tweens[g].run(f);return h.notifyWith(a,[j,f,c]),1>f&&i?c:(h.resolveWith(a,[j]),!1)},j=h.promise({elem:a,props:n.extend({},b),opts:n.extend(!0,{specialEasing:{},easing:n.easing._default},c),originalProperties:b,originalOptions:c,startTime:hb||lb(),duration:c.duration,tweens:[],createTween:function(b,c){var d=n.Tween(a,j.opts,b,c,j.opts.specialEasing[b]||j.opts.easing);return j.tweens.push(d),d},stop:function(b){var c=0,d=b?j.tweens.length:0;if(e)return this;for(e=!0;d>c;c++)j.tweens[c].run(1);return b?(h.notifyWith(a,[j,1,0]),h.resolveWith(a,[j,b])):h.rejectWith(a,[j,b]),this}}),k=j.props;for(pb(k,j.opts.specialEasing);g>f;f++)if(d=qb.prefilters[f].call(j,a,k,j.opts))return n.isFunction(d.stop)&&(n._queueHooks(j.elem,j.opts.queue).stop=n.proxy(d.stop,d)),d;return n.map(k,nb,j),n.isFunction(j.opts.start)&&j.opts.start.call(a,j),n.fx.timer(n.extend(i,{elem:a,anim:j,queue:j.opts.queue})),j.progress(j.opts.progress).done(j.opts.done,j.opts.complete).fail(j.opts.fail).always(j.opts.always)}n.Animation=n.extend(qb,{tweeners:{"*":[function(a,b){var c=this.createTween(a,b);return X(c.elem,a,U.exec(b),c),c}]},tweener:function(a,b){n.isFunction(a)?(b=a,a=["*"]):a=a.match(G);for(var c,d=0,e=a.length;e>d;d++)c=a[d],qb.tweeners[c]=qb.tweeners[c]||[],qb.tweeners[c].unshift(b)},prefilters:[ob],prefilter:function(a,b){b?qb.prefilters.unshift(a):qb.prefilters.push(a)}}),n.speed=function(a,b,c){var d=a&&"object"==typeof a?n.extend({},a):{complete:c||!c&&b||n.isFunction(a)&&a,duration:a,easing:c&&b||b&&!n.isFunction(b)&&b};return d.duration=n.fx.off?0:"number"==typeof d.duration?d.duration:d.duration in n.fx.speeds?n.fx.speeds[d.duration]:n.fx.speeds._default,null!=d.queue&&d.queue!==!0||(d.queue="fx"),d.old=d.complete,d.complete=function(){n.isFunction(d.old)&&d.old.call(this),d.queue&&n.dequeue(this,d.queue)},d},n.fn.extend({fadeTo:function(a,b,c,d){return this.filter(W).css("opacity",0).show().end().animate({opacity:b},a,c,d)},animate:function(a,b,c,d){var e=n.isEmptyObject(a),f=n.speed(b,c,d),g=function(){var b=qb(this,n.extend({},a),f);(e||n._data(this,"finish"))&&b.stop(!0)};return g.finish=g,e||f.queue===!1?this.each(g):this.queue(f.queue,g)},stop:function(a,b,c){var d=function(a){var b=a.stop;delete a.stop,b(c)};return"string"!=typeof a&&(c=b,b=a,a=void 0),b&&a!==!1&&this.queue(a||"fx",[]),this.each(function(){var b=!0,e=null!=a&&a+"queueHooks",f=n.timers,g=n._data(this);if(e)g[e]&&g[e].stop&&d(g[e]);else for(e in g)g[e]&&g[e].stop&&kb.test(e)&&d(g[e]);for(e=f.length;e--;)f[e].elem!==this||null!=a&&f[e].queue!==a||(f[e].anim.stop(c),b=!1,f.splice(e,1));!b&&c||n.dequeue(this,a)})},finish:function(a){return a!==!1&&(a=a||"fx"),this.each(function(){var b,c=n._data(this),d=c[a+"queue"],e=c[a+"queueHooks"],f=n.timers,g=d?d.length:0;for(c.finish=!0,n.queue(this,a,[]),e&&e.stop&&e.stop.call(this,!0),b=f.length;b--;)f[b].elem===this&&f[b].queue===a&&(f[b].anim.stop(!0),f.splice(b,1));for(b=0;g>b;b++)d[b]&&d[b].finish&&d[b].finish.call(this);delete c.finish})}}),n.each(["toggle","show","hide"],function(a,b){var c=n.fn[b];n.fn[b]=function(a,d,e){return null==a||"boolean"==typeof a?c.apply(this,arguments):this.animate(mb(b,!0),a,d,e)}}),n.each({slideDown:mb("show"),slideUp:mb("hide"),slideToggle:mb("toggle"),fadeIn:{opacity:"show"},fadeOut:{opacity:"hide"},fadeToggle:{opacity:"toggle"}},function(a,b){n.fn[a]=function(a,c,d){return this.animate(b,a,c,d)}}),n.timers=[],n.fx.tick=function(){var a,b=n.timers,c=0;for(hb=n.now();c<b.length;c++)a=b[c],a()||b[c]!==a||b.splice(c--,1);b.length||n.fx.stop(),hb=void 0},n.fx.timer=function(a){n.timers.push(a),a()?n.fx.start():n.timers.pop()},n.fx.interval=13,n.fx.start=function(){ib||(ib=a.setInterval(n.fx.tick,n.fx.interval))},n.fx.stop=function(){a.clearInterval(ib),ib=null},n.fx.speeds={slow:600,fast:200,_default:400},n.fn.delay=function(b,c){return b=n.fx?n.fx.speeds[b]||b:b,c=c||"fx",this.queue(c,function(c,d){var e=a.setTimeout(c,b);d.stop=function(){a.clearTimeout(e)}})},function(){var a,b=d.createElement("input"),c=d.createElement("div"),e=d.createElement("select"),f=e.appendChild(d.createElement("option"));c=d.createElement("div"),c.setAttribute("className","t"),c.innerHTML="  <link/><table></table><a href='/a'>a</a><input type='checkbox'/>",a=c.getElementsByTagName("a")[0],b.setAttribute("type","checkbox"),c.appendChild(b),a=c.getElementsByTagName("a")[0],a.style.cssText="top:1px",l.getSetAttribute="t"!==c.className,l.style=/top/.test(a.getAttribute("style")),l.hrefNormalized="/a"===a.getAttribute("href"),l.checkOn=!!b.value,l.optSelected=f.selected,l.enctype=!!d.createElement("form").enctype,e.disabled=!0,l.optDisabled=!f.disabled,b=d.createElement("input"),b.setAttribute("value",""),l.input=""===b.getAttribute("value"),b.value="t",b.setAttribute("type","radio"),l.radioValue="t"===b.value}();var rb=/\r/g,sb=/[\x20\t\r\n\f]+/g;n.fn.extend({val:function(a){var b,c,d,e=this[0];{if(arguments.length)return d=n.isFunction(a),this.each(function(c){var e;1===this.nodeType&&(e=d?a.call(this,c,n(this).val()):a,null==e?e="":"number"==typeof e?e+="":n.isArray(e)&&(e=n.map(e,function(a){return null==a?"":a+""})),b=n.valHooks[this.type]||n.valHooks[this.nodeName.toLowerCase()],b&&"set"in b&&void 0!==b.set(this,e,"value")||(this.value=e))});if(e)return b=n.valHooks[e.type]||n.valHooks[e.nodeName.toLowerCase()],b&&"get"in b&&void 0!==(c=b.get(e,"value"))?c:(c=e.value,"string"==typeof c?c.replace(rb,""):null==c?"":c)}}}),n.extend({valHooks:{option:{get:function(a){var b=n.find.attr(a,"value");return null!=b?b:n.trim(n.text(a)).replace(sb," ")}},select:{get:function(a){for(var b,c,d=a.options,e=a.selectedIndex,f="select-one"===a.type||0>e,g=f?null:[],h=f?e+1:d.length,i=0>e?h:f?e:0;h>i;i++)if(c=d[i],(c.selected||i===e)&&(l.optDisabled?!c.disabled:null===c.getAttribute("disabled"))&&(!c.parentNode.disabled||!n.nodeName(c.parentNode,"optgroup"))){if(b=n(c).val(),f)return b;g.push(b)}return g},set:function(a,b){var c,d,e=a.options,f=n.makeArray(b),g=e.length;while(g--)if(d=e[g],n.inArray(n.valHooks.option.get(d),f)>-1)try{d.selected=c=!0}catch(h){d.scrollHeight}else d.selected=!1;return c||(a.selectedIndex=-1),e}}}}),n.each(["radio","checkbox"],function(){n.valHooks[this]={set:function(a,b){return n.isArray(b)?a.checked=n.inArray(n(a).val(),b)>-1:void 0}},l.checkOn||(n.valHooks[this].get=function(a){return null===a.getAttribute("value")?"on":a.value})});var tb,ub,vb=n.expr.attrHandle,wb=/^(?:checked|selected)$/i,xb=l.getSetAttribute,yb=l.input;n.fn.extend({attr:function(a,b){return Y(this,n.attr,a,b,arguments.length>1)},removeAttr:function(a){return this.each(function(){n.removeAttr(this,a)})}}),n.extend({attr:function(a,b,c){var d,e,f=a.nodeType;if(3!==f&&8!==f&&2!==f)return"undefined"==typeof a.getAttribute?n.prop(a,b,c):(1===f&&n.isXMLDoc(a)||(b=b.toLowerCase(),e=n.attrHooks[b]||(n.expr.match.bool.test(b)?ub:tb)),void 0!==c?null===c?void n.removeAttr(a,b):e&&"set"in e&&void 0!==(d=e.set(a,c,b))?d:(a.setAttribute(b,c+""),c):e&&"get"in e&&null!==(d=e.get(a,b))?d:(d=n.find.attr(a,b),null==d?void 0:d))},attrHooks:{type:{set:function(a,b){if(!l.radioValue&&"radio"===b&&n.nodeName(a,"input")){var c=a.value;return a.setAttribute("type",b),c&&(a.value=c),b}}}},removeAttr:function(a,b){var c,d,e=0,f=b&&b.match(G);if(f&&1===a.nodeType)while(c=f[e++])d=n.propFix[c]||c,n.expr.match.bool.test(c)?yb&&xb||!wb.test(c)?a[d]=!1:a[n.camelCase("default-"+c)]=a[d]=!1:n.attr(a,c,""),a.removeAttribute(xb?c:d)}}),ub={set:function(a,b,c){return b===!1?n.removeAttr(a,c):yb&&xb||!wb.test(c)?a.setAttribute(!xb&&n.propFix[c]||c,c):a[n.camelCase("default-"+c)]=a[c]=!0,c}},n.each(n.expr.match.bool.source.match(/\w+/g),function(a,b){var c=vb[b]||n.find.attr;yb&&xb||!wb.test(b)?vb[b]=function(a,b,d){var e,f;return d||(f=vb[b],vb[b]=e,e=null!=c(a,b,d)?b.toLowerCase():null,vb[b]=f),e}:vb[b]=function(a,b,c){return c?void 0:a[n.camelCase("default-"+b)]?b.toLowerCase():null}}),yb&&xb||(n.attrHooks.value={set:function(a,b,c){return n.nodeName(a,"input")?void(a.defaultValue=b):tb&&tb.set(a,b,c)}}),xb||(tb={set:function(a,b,c){var d=a.getAttributeNode(c);return d||a.setAttributeNode(d=a.ownerDocument.createAttribute(c)),d.value=b+="","value"===c||b===a.getAttribute(c)?b:void 0}},vb.id=vb.name=vb.coords=function(a,b,c){var d;return c?void 0:(d=a.getAttributeNode(b))&&""!==d.value?d.value:null},n.valHooks.button={get:function(a,b){var c=a.getAttributeNode(b);return c&&c.specified?c.value:void 0},set:tb.set},n.attrHooks.contenteditable={set:function(a,b,c){tb.set(a,""===b?!1:b,c)}},n.each(["width","height"],function(a,b){n.attrHooks[b]={set:function(a,c){return""===c?(a.setAttribute(b,"auto"),c):void 0}}})),l.style||(n.attrHooks.style={get:function(a){return a.style.cssText||void 0},set:function(a,b){return a.style.cssText=b+""}});var zb=/^(?:input|select|textarea|button|object)$/i,Ab=/^(?:a|area)$/i;n.fn.extend({prop:function(a,b){return Y(this,n.prop,a,b,arguments.length>1)},removeProp:function(a){return a=n.propFix[a]||a,this.each(function(){try{this[a]=void 0,delete this[a]}catch(b){}})}}),n.extend({prop:function(a,b,c){var d,e,f=a.nodeType;if(3!==f&&8!==f&&2!==f)return 1===f&&n.isXMLDoc(a)||(b=n.propFix[b]||b,e=n.propHooks[b]),void 0!==c?e&&"set"in e&&void 0!==(d=e.set(a,c,b))?d:a[b]=c:e&&"get"in e&&null!==(d=e.get(a,b))?d:a[b]},propHooks:{tabIndex:{get:function(a){var b=n.find.attr(a,"tabindex");return b?parseInt(b,10):zb.test(a.nodeName)||Ab.test(a.nodeName)&&a.href?0:-1}}},propFix:{"for":"htmlFor","class":"className"}}),l.hrefNormalized||n.each(["href","src"],function(a,b){n.propHooks[b]={get:function(a){return a.getAttribute(b,4)}}}),l.optSelected||(n.propHooks.selected={get:function(a){var b=a.parentNode;return b&&(b.selectedIndex,b.parentNode&&b.parentNode.selectedIndex),null},set:function(a){var b=a.parentNode;b&&(b.selectedIndex,b.parentNode&&b.parentNode.selectedIndex)}}),n.each(["tabIndex","readOnly","maxLength","cellSpacing","cellPadding","rowSpan","colSpan","useMap","frameBorder","contentEditable"],function(){n.propFix[this.toLowerCase()]=this}),l.enctype||(n.propFix.enctype="encoding");var Bb=/[\t\r\n\f]/g;function Cb(a){return n.attr(a,"class")||""}n.fn.extend({addClass:function(a){var b,c,d,e,f,g,h,i=0;if(n.isFunction(a))return this.each(function(b){n(this).addClass(a.call(this,b,Cb(this)))});if("string"==typeof a&&a){b=a.match(G)||[];while(c=this[i++])if(e=Cb(c),d=1===c.nodeType&&(" "+e+" ").replace(Bb," ")){g=0;while(f=b[g++])d.indexOf(" "+f+" ")<0&&(d+=f+" ");h=n.trim(d),e!==h&&n.attr(c,"class",h)}}return this},removeClass:function(a){var b,c,d,e,f,g,h,i=0;if(n.isFunction(a))return this.each(function(b){n(this).removeClass(a.call(this,b,Cb(this)))});if(!arguments.length)return this.attr("class","");if("string"==typeof a&&a){b=a.match(G)||[];while(c=this[i++])if(e=Cb(c),d=1===c.nodeType&&(" "+e+" ").replace(Bb," ")){g=0;while(f=b[g++])while(d.indexOf(" "+f+" ")>-1)d=d.replace(" "+f+" "," ");h=n.trim(d),e!==h&&n.attr(c,"class",h)}}return this},toggleClass:function(a,b){var c=typeof a;return"boolean"==typeof b&&"string"===c?b?this.addClass(a):this.removeClass(a):n.isFunction(a)?this.each(function(c){n(this).toggleClass(a.call(this,c,Cb(this),b),b)}):this.each(function(){var b,d,e,f;if("string"===c){d=0,e=n(this),f=a.match(G)||[];while(b=f[d++])e.hasClass(b)?e.removeClass(b):e.addClass(b)}else void 0!==a&&"boolean"!==c||(b=Cb(this),b&&n._data(this,"__className__",b),n.attr(this,"class",b||a===!1?"":n._data(this,"__className__")||""))})},hasClass:function(a){var b,c,d=0;b=" "+a+" ";while(c=this[d++])if(1===c.nodeType&&(" "+Cb(c)+" ").replace(Bb," ").indexOf(b)>-1)return!0;return!1}}),n.each("blur focus focusin focusout load resize scroll unload click dblclick mousedown mouseup mousemove mouseover mouseout mouseenter mouseleave change select submit keydown keypress keyup error contextmenu".split(" "),function(a,b){n.fn[b]=function(a,c){return arguments.length>0?this.on(b,null,a,c):this.trigger(b)}}),n.fn.extend({hover:function(a,b){return this.mouseenter(a).mouseleave(b||a)}});var Db=a.location,Eb=n.now(),Fb=/\?/,Gb=/(,)|(\[|{)|(}|])|"(?:[^"\\\r\n]|\\["\\\/bfnrt]|\\u[\da-fA-F]{4})*"\s*:?|true|false|null|-?(?!0\d)\d+(?:\.\d+|)(?:[eE][+-]?\d+|)/g;n.parseJSON=function(b){if(a.JSON&&a.JSON.parse)return a.JSON.parse(b+"");var c,d=null,e=n.trim(b+"");return e&&!n.trim(e.replace(Gb,function(a,b,e,f){return c&&b&&(d=0),0===d?a:(c=e||b,d+=!f-!e,"")}))?Function("return "+e)():n.error("Invalid JSON: "+b)},n.parseXML=function(b){var c,d;if(!b||"string"!=typeof b)return null;try{a.DOMParser?(d=new a.DOMParser,c=d.parseFromString(b,"text/xml")):(c=new a.ActiveXObject("Microsoft.XMLDOM"),c.async="false",c.loadXML(b))}catch(e){c=void 0}return c&&c.documentElement&&!c.getElementsByTagName("parsererror").length||n.error("Invalid XML: "+b),c};var Hb=/#.*$/,Ib=/([?&])_=[^&]*/,Jb=/^(.*?):[ \t]*([^\r\n]*)\r?$/gm,Kb=/^(?:about|app|app-storage|.+-extension|file|res|widget):$/,Lb=/^(?:GET|HEAD)$/,Mb=/^\/\//,Nb=/^([\w.+-]+:)(?:\/\/(?:[^\/?#]*@|)([^\/?#:]*)(?::(\d+)|)|)/,Ob={},Pb={},Qb="*/".concat("*"),Rb=Db.href,Sb=Nb.exec(Rb.toLowerCase())||[];function Tb(a){return function(b,c){"string"!=typeof b&&(c=b,b="*");var d,e=0,f=b.toLowerCase().match(G)||[];if(n.isFunction(c))while(d=f[e++])"+"===d.charAt(0)?(d=d.slice(1)||"*",(a[d]=a[d]||[]).unshift(c)):(a[d]=a[d]||[]).push(c)}}function Ub(a,b,c,d){var e={},f=a===Pb;function g(h){var i;return e[h]=!0,n.each(a[h]||[],function(a,h){var j=h(b,c,d);return"string"!=typeof j||f||e[j]?f?!(i=j):void 0:(b.dataTypes.unshift(j),g(j),!1)}),i}return g(b.dataTypes[0])||!e["*"]&&g("*")}function Vb(a,b){var c,d,e=n.ajaxSettings.flatOptions||{};for(d in b)void 0!==b[d]&&((e[d]?a:c||(c={}))[d]=b[d]);return c&&n.extend(!0,a,c),a}function Wb(a,b,c){var d,e,f,g,h=a.contents,i=a.dataTypes;while("*"===i[0])i.shift(),void 0===e&&(e=a.mimeType||b.getResponseHeader("Content-Type"));if(e)for(g in h)if(h[g]&&h[g].test(e)){i.unshift(g);break}if(i[0]in c)f=i[0];else{for(g in c){if(!i[0]||a.converters[g+" "+i[0]]){f=g;break}d||(d=g)}f=f||d}return f?(f!==i[0]&&i.unshift(f),c[f]):void 0}function Xb(a,b,c,d){var e,f,g,h,i,j={},k=a.dataTypes.slice();if(k[1])for(g in a.converters)j[g.toLowerCase()]=a.converters[g];f=k.shift();while(f)if(a.responseFields[f]&&(c[a.responseFields[f]]=b),!i&&d&&a.dataFilter&&(b=a.dataFilter(b,a.dataType)),i=f,f=k.shift())if("*"===f)f=i;else if("*"!==i&&i!==f){if(g=j[i+" "+f]||j["* "+f],!g)for(e in j)if(h=e.split(" "),h[1]===f&&(g=j[i+" "+h[0]]||j["* "+h[0]])){g===!0?g=j[e]:j[e]!==!0&&(f=h[0],k.unshift(h[1]));break}if(g!==!0)if(g&&a["throws"])b=g(b);else try{b=g(b)}catch(l){return{state:"parsererror",error:g?l:"No conversion from "+i+" to "+f}}}return{state:"success",data:b}}n.extend({active:0,lastModified:{},etag:{},ajaxSettings:{url:Rb,type:"GET",isLocal:Kb.test(Sb[1]),global:!0,processData:!0,async:!0,contentType:"application/x-www-form-urlencoded; charset=UTF-8",accepts:{"*":Qb,text:"text/plain",html:"text/html",xml:"application/xml, text/xml",json:"application/json, text/javascript"},contents:{xml:/\bxml\b/,html:/\bhtml/,json:/\bjson\b/},responseFields:{xml:"responseXML",text:"responseText",json:"responseJSON"},converters:{"* text":String,"text html":!0,"text json":n.parseJSON,"text xml":n.parseXML},flatOptions:{url:!0,context:!0}},ajaxSetup:function(a,b){return b?Vb(Vb(a,n.ajaxSettings),b):Vb(n.ajaxSettings,a)},ajaxPrefilter:Tb(Ob),ajaxTransport:Tb(Pb),ajax:function(b,c){"object"==typeof b&&(c=b,b=void 0),c=c||{};var d,e,f,g,h,i,j,k,l=n.ajaxSetup({},c),m=l.context||l,o=l.context&&(m.nodeType||m.jquery)?n(m):n.event,p=n.Deferred(),q=n.Callbacks("once memory"),r=l.statusCode||{},s={},t={},u=0,v="canceled",w={readyState:0,getResponseHeader:function(a){var b;if(2===u){if(!k){k={};while(b=Jb.exec(g))k[b[1].toLowerCase()]=b[2]}b=k[a.toLowerCase()]}return null==b?null:b},getAllResponseHeaders:function(){return 2===u?g:null},setRequestHeader:function(a,b){var c=a.toLowerCase();return u||(a=t[c]=t[c]||a,s[a]=b),this},overrideMimeType:function(a){return u||(l.mimeType=a),this},statusCode:function(a){var b;if(a)if(2>u)for(b in a)r[b]=[r[b],a[b]];else w.always(a[w.status]);return this},abort:function(a){var b=a||v;return j&&j.abort(b),y(0,b),this}};if(p.promise(w).complete=q.add,w.success=w.done,w.error=w.fail,l.url=((b||l.url||Rb)+"").replace(Hb,"").replace(Mb,Sb[1]+"//"),l.type=c.method||c.type||l.method||l.type,l.dataTypes=n.trim(l.dataType||"*").toLowerCase().match(G)||[""],null==l.crossDomain&&(d=Nb.exec(l.url.toLowerCase()),l.crossDomain=!(!d||d[1]===Sb[1]&&d[2]===Sb[2]&&(d[3]||("http:"===d[1]?"80":"443"))===(Sb[3]||("http:"===Sb[1]?"80":"443")))),l.data&&l.processData&&"string"!=typeof l.data&&(l.data=n.param(l.data,l.traditional)),Ub(Ob,l,c,w),2===u)return w;i=n.event&&l.global,i&&0===n.active++&&n.event.trigger("ajaxStart"),l.type=l.type.toUpperCase(),l.hasContent=!Lb.test(l.type),f=l.url,l.hasContent||(l.data&&(f=l.url+=(Fb.test(f)?"&":"?")+l.data,delete l.data),l.cache===!1&&(l.url=Ib.test(f)?f.replace(Ib,"$1_="+Eb++):f+(Fb.test(f)?"&":"?")+"_="+Eb++)),l.ifModified&&(n.lastModified[f]&&w.setRequestHeader("If-Modified-Since",n.lastModified[f]),n.etag[f]&&w.setRequestHeader("If-None-Match",n.etag[f])),(l.data&&l.hasContent&&l.contentType!==!1||c.contentType)&&w.setRequestHeader("Content-Type",l.contentType),w.setRequestHeader("Accept",l.dataTypes[0]&&l.accepts[l.dataTypes[0]]?l.accepts[l.dataTypes[0]]+("*"!==l.dataTypes[0]?", "+Qb+"; q=0.01":""):l.accepts["*"]);for(e in l.headers)w.setRequestHeader(e,l.headers[e]);if(l.beforeSend&&(l.beforeSend.call(m,w,l)===!1||2===u))return w.abort();v="abort";for(e in{success:1,error:1,complete:1})w[e](l[e]);if(j=Ub(Pb,l,c,w)){if(w.readyState=1,i&&o.trigger("ajaxSend",[w,l]),2===u)return w;l.async&&l.timeout>0&&(h=a.setTimeout(function(){w.abort("timeout")},l.timeout));try{u=1,j.send(s,y)}catch(x){if(!(2>u))throw x;y(-1,x)}}else y(-1,"No Transport");function y(b,c,d,e){var k,s,t,v,x,y=c;2!==u&&(u=2,h&&a.clearTimeout(h),j=void 0,g=e||"",w.readyState=b>0?4:0,k=b>=200&&300>b||304===b,d&&(v=Wb(l,w,d)),v=Xb(l,v,w,k),k?(l.ifModified&&(x=w.getResponseHeader("Last-Modified"),x&&(n.lastModified[f]=x),x=w.getResponseHeader("etag"),x&&(n.etag[f]=x)),204===b||"HEAD"===l.type?y="nocontent":304===b?y="notmodified":(y=v.state,s=v.data,t=v.error,k=!t)):(t=y,!b&&y||(y="error",0>b&&(b=0))),w.status=b,w.statusText=(c||y)+"",k?p.resolveWith(m,[s,y,w]):p.rejectWith(m,[w,y,t]),w.statusCode(r),r=void 0,i&&o.trigger(k?"ajaxSuccess":"ajaxError",[w,l,k?s:t]),q.fireWith(m,[w,y]),i&&(o.trigger("ajaxComplete",[w,l]),--n.active||n.event.trigger("ajaxStop")))}return w},getJSON:function(a,b,c){return n.get(a,b,c,"json")},getScript:function(a,b){return n.get(a,void 0,b,"script")}}),n.each(["get","post"],function(a,b){n[b]=function(a,c,d,e){return n.isFunction(c)&&(e=e||d,d=c,c=void 0),n.ajax(n.extend({url:a,type:b,dataType:e,data:c,success:d},n.isPlainObject(a)&&a))}}),n._evalUrl=function(a){return n.ajax({url:a,type:"GET",dataType:"script",cache:!0,async:!1,global:!1,"throws":!0})},n.fn.extend({wrapAll:function(a){if(n.isFunction(a))return this.each(function(b){n(this).wrapAll(a.call(this,b))});if(this[0]){var b=n(a,this[0].ownerDocument).eq(0).clone(!0);this[0].parentNode&&b.insertBefore(this[0]),b.map(function(){var a=this;while(a.firstChild&&1===a.firstChild.nodeType)a=a.firstChild;return a}).append(this)}return this},wrapInner:function(a){return n.isFunction(a)?this.each(function(b){n(this).wrapInner(a.call(this,b))}):this.each(function(){var b=n(this),c=b.contents();c.length?c.wrapAll(a):b.append(a)})},wrap:function(a){var b=n.isFunction(a);return this.each(function(c){n(this).wrapAll(b?a.call(this,c):a)})},unwrap:function(){return this.parent().each(function(){n.nodeName(this,"body")||n(this).replaceWith(this.childNodes)}).end()}});function Yb(a){return a.style&&a.style.display||n.css(a,"display")}function Zb(a){if(!n.contains(a.ownerDocument||d,a))return!0;while(a&&1===a.nodeType){if("none"===Yb(a)||"hidden"===a.type)return!0;a=a.parentNode}return!1}n.expr.filters.hidden=function(a){return l.reliableHiddenOffsets()?a.offsetWidth<=0&&a.offsetHeight<=0&&!a.getClientRects().length:Zb(a)},n.expr.filters.visible=function(a){return!n.expr.filters.hidden(a)};var $b=/%20/g,_b=/\[\]$/,ac=/\r?\n/g,bc=/^(?:submit|button|image|reset|file)$/i,cc=/^(?:input|select|textarea|keygen)/i;function dc(a,b,c,d){var e;if(n.isArray(b))n.each(b,function(b,e){c||_b.test(a)?d(a,e):dc(a+"["+("object"==typeof e&&null!=e?b:"")+"]",e,c,d)});else if(c||"object"!==n.type(b))d(a,b);else for(e in b)dc(a+"["+e+"]",b[e],c,d)}n.param=function(a,b){var c,d=[],e=function(a,b){b=n.isFunction(b)?b():null==b?"":b,d[d.length]=encodeURIComponent(a)+"="+encodeURIComponent(b)};if(void 0===b&&(b=n.ajaxSettings&&n.ajaxSettings.traditional),n.isArray(a)||a.jquery&&!n.isPlainObject(a))n.each(a,function(){e(this.name,this.value)});else for(c in a)dc(c,a[c],b,e);return d.join("&").replace($b,"+")},n.fn.extend({serialize:function(){return n.param(this.serializeArray())},serializeArray:function(){return this.map(function(){var a=n.prop(this,"elements");return a?n.makeArray(a):this}).filter(function(){var a=this.type;return this.name&&!n(this).is(":disabled")&&cc.test(this.nodeName)&&!bc.test(a)&&(this.checked||!Z.test(a))}).map(function(a,b){var c=n(this).val();return null==c?null:n.isArray(c)?n.map(c,function(a){return{name:b.name,value:a.replace(ac,"\r\n")}}):{name:b.name,value:c.replace(ac,"\r\n")}}).get()}}),n.ajaxSettings.xhr=void 0!==a.ActiveXObject?function(){return this.isLocal?ic():d.documentMode>8?hc():/^(get|post|head|put|delete|options)$/i.test(this.type)&&hc()||ic()}:hc;var ec=0,fc={},gc=n.ajaxSettings.xhr();a.attachEvent&&a.attachEvent("onunload",function(){for(var a in fc)fc[a](void 0,!0)}),l.cors=!!gc&&"withCredentials"in gc,gc=l.ajax=!!gc,gc&&n.ajaxTransport(function(b){if(!b.crossDomain||l.cors){var c;return{send:function(d,e){var f,g=b.xhr(),h=++ec;if(g.open(b.type,b.url,b.async,b.username,b.password),b.xhrFields)for(f in b.xhrFields)g[f]=b.xhrFields[f];b.mimeType&&g.overrideMimeType&&g.overrideMimeType(b.mimeType),b.crossDomain||d["X-Requested-With"]||(d["X-Requested-With"]="XMLHttpRequest");for(f in d)void 0!==d[f]&&g.setRequestHeader(f,d[f]+"");g.send(b.hasContent&&b.data||null),c=function(a,d){var f,i,j;if(c&&(d||4===g.readyState))if(delete fc[h],c=void 0,g.onreadystatechange=n.noop,d)4!==g.readyState&&g.abort();else{j={},f=g.status,"string"==typeof g.responseText&&(j.text=g.responseText);try{i=g.statusText}catch(k){i=""}f||!b.isLocal||b.crossDomain?1223===f&&(f=204):f=j.text?200:404}j&&e(f,i,j,g.getAllResponseHeaders())},b.async?4===g.readyState?a.setTimeout(c):g.onreadystatechange=fc[h]=c:c()},abort:function(){c&&c(void 0,!0)}}}});function hc(){try{return new a.XMLHttpRequest}catch(b){}}function ic(){try{return new a.ActiveXObject("Microsoft.XMLHTTP")}catch(b){}}n.ajaxSetup({accepts:{script:"text/javascript, application/javascript, application/ecmascript, application/x-ecmascript"},contents:{script:/\b(?:java|ecma)script\b/},converters:{"text script":function(a){return n.globalEval(a),a}}}),n.ajaxPrefilter("script",function(a){void 0===a.cache&&(a.cache=!1),a.crossDomain&&(a.type="GET",a.global=!1)}),n.ajaxTransport("script",function(a){if(a.crossDomain){var b,c=d.head||n("head")[0]||d.documentElement;return{send:function(e,f){b=d.createElement("script"),b.async=!0,a.scriptCharset&&(b.charset=a.scriptCharset),b.src=a.url,b.onload=b.onreadystatechange=function(a,c){(c||!b.readyState||/loaded|complete/.test(b.readyState))&&(b.onload=b.onreadystatechange=null,b.parentNode&&b.parentNode.removeChild(b),b=null,c||f(200,"success"))},c.insertBefore(b,c.firstChild)},abort:function(){b&&b.onload(void 0,!0)}}}});var jc=[],kc=/(=)\?(?=&|$)|\?\?/;n.ajaxSetup({jsonp:"callback",jsonpCallback:function(){var a=jc.pop()||n.expando+"_"+Eb++;return this[a]=!0,a}}),n.ajaxPrefilter("json jsonp",function(b,c,d){var e,f,g,h=b.jsonp!==!1&&(kc.test(b.url)?"url":"string"==typeof b.data&&0===(b.contentType||"").indexOf("application/x-www-form-urlencoded")&&kc.test(b.data)&&"data");return h||"jsonp"===b.dataTypes[0]?(e=b.jsonpCallback=n.isFunction(b.jsonpCallback)?b.jsonpCallback():b.jsonpCallback,h?b[h]=b[h].replace(kc,"$1"+e):b.jsonp!==!1&&(b.url+=(Fb.test(b.url)?"&":"?")+b.jsonp+"="+e),b.converters["script json"]=function(){return g||n.error(e+" was not called"),g[0]},b.dataTypes[0]="json",f=a[e],a[e]=function(){g=arguments},d.always(function(){void 0===f?n(a).removeProp(e):a[e]=f,b[e]&&(b.jsonpCallback=c.jsonpCallback,jc.push(e)),g&&n.isFunction(f)&&f(g[0]),g=f=void 0}),"script"):void 0}),n.parseHTML=function(a,b,c){if(!a||"string"!=typeof a)return null;"boolean"==typeof b&&(c=b,b=!1),b=b||d;var e=x.exec(a),f=!c&&[];return e?[b.createElement(e[1])]:(e=ja([a],b,f),f&&f.length&&n(f).remove(),n.merge([],e.childNodes))};var lc=n.fn.load;n.fn.load=function(a,b,c){if("string"!=typeof a&&lc)return lc.apply(this,arguments);var d,e,f,g=this,h=a.indexOf(" ");return h>-1&&(d=n.trim(a.slice(h,a.length)),a=a.slice(0,h)),n.isFunction(b)?(c=b,b=void 0):b&&"object"==typeof b&&(e="POST"),g.length>0&&n.ajax({url:a,type:e||"GET",dataType:"html",data:b}).done(function(a){f=arguments,g.html(d?n("<div>").append(n.parseHTML(a)).find(d):a)}).always(c&&function(a,b){g.each(function(){c.apply(this,f||[a.responseText,b,a])})}),this},n.each(["ajaxStart","ajaxStop","ajaxComplete","ajaxError","ajaxSuccess","ajaxSend"],function(a,b){n.fn[b]=function(a){return this.on(b,a)}}),n.expr.filters.animated=function(a){return n.grep(n.timers,function(b){return a===b.elem}).length};function mc(a){return n.isWindow(a)?a:9===a.nodeType?a.defaultView||a.parentWindow:!1}n.offset={setOffset:function(a,b,c){var d,e,f,g,h,i,j,k=n.css(a,"position"),l=n(a),m={};"static"===k&&(a.style.position="relative"),h=l.offset(),f=n.css(a,"top"),i=n.css(a,"left"),j=("absolute"===k||"fixed"===k)&&n.inArray("auto",[f,i])>-1,j?(d=l.position(),g=d.top,e=d.left):(g=parseFloat(f)||0,e=parseFloat(i)||0),n.isFunction(b)&&(b=b.call(a,c,n.extend({},h))),null!=b.top&&(m.top=b.top-h.top+g),null!=b.left&&(m.left=b.left-h.left+e),"using"in b?b.using.call(a,m):l.css(m)}},n.fn.extend({offset:function(a){if(arguments.length)return void 0===a?this:this.each(function(b){n.offset.setOffset(this,a,b)});var b,c,d={top:0,left:0},e=this[0],f=e&&e.ownerDocument;if(f)return b=f.documentElement,n.contains(b,e)?("undefined"!=typeof e.getBoundingClientRect&&(d=e.getBoundingClientRect()),c=mc(f),{top:d.top+(c.pageYOffset||b.scrollTop)-(b.clientTop||0),left:d.left+(c.pageXOffset||b.scrollLeft)-(b.clientLeft||0)}):d},position:function(){if(this[0]){var a,b,c={top:0,left:0},d=this[0];return"fixed"===n.css(d,"position")?b=d.getBoundingClientRect():(a=this.offsetParent(),b=this.offset(),n.nodeName(a[0],"html")||(c=a.offset()),c.top+=n.css(a[0],"borderTopWidth",!0),c.left+=n.css(a[0],"borderLeftWidth",!0)),{top:b.top-c.top-n.css(d,"marginTop",!0),left:b.left-c.left-n.css(d,"marginLeft",!0)}}},offsetParent:function(){return this.map(function(){var a=this.offsetParent;while(a&&!n.nodeName(a,"html")&&"static"===n.css(a,"position"))a=a.offsetParent;return a||Qa})}}),n.each({scrollLeft:"pageXOffset",scrollTop:"pageYOffset"},function(a,b){var c=/Y/.test(b);n.fn[a]=function(d){return Y(this,function(a,d,e){var f=mc(a);return void 0===e?f?b in f?f[b]:f.document.documentElement[d]:a[d]:void(f?f.scrollTo(c?n(f).scrollLeft():e,c?e:n(f).scrollTop()):a[d]=e)},a,d,arguments.length,null)}}),n.each(["top","left"],function(a,b){n.cssHooks[b]=Ua(l.pixelPosition,function(a,c){return c?(c=Sa(a,b),Oa.test(c)?n(a).position()[b]+"px":c):void 0})}),n.each({Height:"height",Width:"width"},function(a,b){n.each({
    padding:"inner"+a,content:b,"":"outer"+a},function(c,d){n.fn[d]=function(d,e){var f=arguments.length&&(c||"boolean"!=typeof d),g=c||(d===!0||e===!0?"margin":"border");return Y(this,function(b,c,d){var e;return n.isWindow(b)?b.document.documentElement["client"+a]:9===b.nodeType?(e=b.documentElement,Math.max(b.body["scroll"+a],e["scroll"+a],b.body["offset"+a],e["offset"+a],e["client"+a])):void 0===d?n.css(b,c,g):n.style(b,c,d,g)},b,f?d:void 0,f,null)}})}),n.fn.extend({bind:function(a,b,c){return this.on(a,null,b,c)},unbind:function(a,b){return this.off(a,null,b)},delegate:function(a,b,c,d){return this.on(b,a,c,d)},undelegate:function(a,b,c){return 1===arguments.length?this.off(a,"**"):this.off(b,a||"**",c)}}),n.fn.size=function(){return this.length},n.fn.andSelf=n.fn.addBack,"function"==typeof define&&define.amd&&define("jquery",[],function(){return n});var nc=a.jQuery,oc=a.$;return n.noConflict=function(b){return a.$===n&&(a.$=oc),b&&a.jQuery===n&&(a.jQuery=nc),n},b||(a.jQuery=a.$=n),n});
if ( typeof(module) !== 'undefined' && module.exports ) {
    var lib = require('../../index');
}

/**
 * Collection cLass
 * Allows you to handle your own collections as you would normaly with mongodb
 * Dependencies :
 *  - lib/merge
 *  - uuid
 *
 *
 * @param {array} collection
 * @param {object} [options]
 *
 * @return {object} instance
 *
 * Collection::find
 *  @param {object} filter
 *      eg.: { uid: 'someUID' }
 *      eg.: { type: 'not null', country: 'France' } // `AND` clause
 *      eg.: { country: 'The Hashemite Kingdom of Jordan' }, { country: 'Libanon'} // `OR` clause 
 *      eg.: { 'obj.prop': true }
 *      eg.: { 'contacts[*].name': 'Doe' } // `WITHIN` (array|collection) clause
 *      eg.: { lastUpdate: '>= 2016-12-01T00:00:00' }  // also available for date comparison `=`, `<`, `>`
 *      eg.: { activity: null }
 *      eg.: { isActive: false }
 *
 *  @return {array} result
 *
 * Collection::findOne
 *  @param {object} filter
 *  @return {object|array|string} result
 *
 * Collection::update
 *  @param {object} filter
 *  @param {object} set
 *
 *  @return {array} result
 *      rasult.toRaw() will give result without chaining & _uuid
 *
 * */
function Collection(content, options) {

    var isGFFCtx        = ( ( typeof(module) !== 'undefined' ) && module.exports ) ? false : true;
    var uuid            = (isGFFCtx) ? require('vendor/uuid') : require('uuid');
    var merge           = (isGFFCtx) ? require('utils/merge') : require('../../../lib/merge');

    // defined search option rules
    var searchOptionRules = {
        isCaseSensitive: {
            false: {
                re: '^%s$',
                modifiers: 'i'
            },
            true: {
                re: '^%s$'
            }
        }
    };
    
    
    var localSearchOptions  = null;
    
    var defaultOptions = {
        useLocalStorage: false,
        locale: 'en', // TODO - get settigs.region, or user.region
        searchOptionRules: searchOptionRules
    };
    
        
    
    options = (typeof(options) == 'object') ? merge(options, defaultOptions) : defaultOptions;

    var keywords    = ['not null']; // TODO - null, exists (`true` if property is defined)
    var tryEval     = function(condition) {
        try {
            return eval(condition)
        } catch(err) {
            throw new Error('Could not evaluate condition `'+ condition +'`.\n' + err.stack )
        }
    }

    if (typeof(content) == 'undefined' || content == '' || content == null)
        content = [];

    if ( !Array.isArray(content) )
        throw new Error('`new Collection([content] [, options] )`: `content` argument must be an Array !');

    content = (content) ? JSON.parse(JSON.stringify(content)) : []; // original content -> not to be touched
        
    // Indexing : uuids are generated for each entry
    for (var entry = 0, entryLen = content.length; entry < entryLen; ++entry) {
        if (!content[entry]) {
            content[entry] = {}
        }
        content[entry]._uuid = uuid.v4();
    }

    var instance = content;
    //instance._options = options;
    
    /**
     * Set local search option for the current collection method call
     * 
     * eg.: 
     *  var recCollection = new Collection(arrayCollection);
     *  var rec =  recCollection
     *                  .setSearchOption('name', 'isCaseSensitive', false)
     *                  .find({ city: 'cap Town' });
     * 
     * eg.:
     *  var recCollection = new Collection(arrayCollection);
     *  var searchOptions = {
     *      name: {
     *          isCaseSensitive: false
     *      }
     *  };
     *  var rec =  recCollection
     *                  .setSearchOption(searchOptions)
     *                  .find({ city: 'cap Town' });     * 
     * 
     * @param {object|string} searchOptionObject or searchOptionTargetedProperty
     * @param {string} [searchRule]
     * @param {boolean} [searchRuleValue] - true to enable, false to disabled
     * 
     * @return {object} instance with local search options
     */
    instance['setSearchOption'] = function() {
        
        if (!arguments.length)
            throw new Error('searchOption cannot be left blank');
            
        if (arguments.length > 3 || arguments.length < 3 && arguments.length > 1)
            throw new Error('argument length mismatch');
        
        var i = 0
            , len = arguments.length
        ;
        
        if (arguments.length == 1) {
            if ( typeof(arguments[0]) != 'object' )
                throw new Error('searchOption must be an object');
                
            for (var prop in arguments[0]) {
                if ( typeof(searchOptionRules[prop]) == 'undefined' )
                    throw new Error(arguments[1] + ' is not an allowed searchOption !');
            }
            
            localSearchOptions = arguments[0];
        } else {
            
            if ( !localSearchOptions )
                localSearchOptions = {};
            
            for (; i < len; ++i) {                
                if ( typeof(searchOptionRules[arguments[1]]) == 'undefined' )
                    throw new Error(arguments[1] + ' is not an allowed searchOption !');
                
                if (typeof(localSearchOptions[arguments[0]]) == 'undefined')
                    localSearchOptions[arguments[0]] = {};
                
                if ( /true|false/i.test(arguments[2]) ) {
                    localSearchOptions[arguments[0]][arguments[1]] = /true/i.test(arguments[2]) ? true : false
                } else {
                    localSearchOptions[arguments[0]][arguments[1]] = arguments[2]
                }                
            }
        }    
        
        return instance
    }

    
    instance['find'] = function() {

        var withOrClause = false;
        
        if ( typeof(arguments[arguments.length-1]) == 'boolean' ) {
            withOrClause = arguments[arguments.length-1];
            delete arguments[arguments.length-1];
            --arguments.length;
        }

        var filtersStr  = JSON.stringify(arguments);
        var filters     = JSON.parse(filtersStr);

        if ( typeof(filters) != 'undefined' && typeof(filters) !== 'object' ) {
            throw new Error('filter must be an object');
        } else if ( typeof(filters) != 'undefined' && filters.count() > 0 ) {
            
            var filter              = null
                , condition         = null
                , i                 = 0
                //, tmpContent        = ( Array.isArray(this) && !withOrClause) ? this : JSON.parse(JSON.stringify(content))
                , tmpContent        = ( Array.isArray(this) ) ? this : JSON.parse(JSON.stringify(content))
                , resultObj         = {}
                , result            = []
                , localeLowerCase   = ''
                , re                = null
                , field             = null
                , fieldWithin       = null
                , value             = null
                , searchOptions     = localSearchOptions
                , searchOptionRules = options.searchOptionRules
                //, searchOptionRules = this._options.searchOptionRules
            ;

            var matched = null
                , filterIsArray = null
                , searchResult = null;
            
            /**
             *  Regular Search
             * @param {object} filter 
             * @param {string} field 
             * @param {strine|number|date} _content 
             * @param {number} matched 
             */
            var search = function(filter, field, _content, matched, searchOptionRules) {
                
                if (filter === null && _content === null) { // null case

                    ++matched;

                } else if (
                    filter 
                    && keywords.indexOf(localeLowerCase) > -1 
                    && localeLowerCase == 'not null' 
                    && typeof(_content) != 'undefined' 
                    && typeof(_content) !== 'object' 
                    && _content != 'null' 
                    && _content != 'undefined'
                ) {
                    
                    if (result.indexOf(_content) < 0) {
                        ++matched;
                    }

                } else if ( 
                    typeof(_content) != 'undefined' 
                    && typeof(_content) !== 'object' 
                    && /(<|>|=)/.test(filter) 
                    && !/undefined|function/.test(typeof(_content))
                ) { // with operations
                    // looking for a datetime ?
                    if (
                        /(\d{4})\-(\d{2})\-(\d{2})(\s+|T)(\d{2}):(\d{2}):(\d{2})/.test(_content)
                        && /(\d{4})\-(\d{2})\-(\d{2})(\s+|T)(\d{2}):(\d{2}):(\d{2})/.test(filter)
                    ) {

                        if (tryEval(_content.replace(/(\d{4})\-(\d{2})\-(\d{2})(\s+|T)(\d{2}):(\d{2}):(\d{2})/, 'new Date("$&")') + filter.replace(/(\d{4})\-(\d{2})\-(\d{2})(\s+|T)(\d{2}):(\d{2}):(\d{2})/, 'new Date("$&")'))) {
                            ++matched;
                        }

                    } else if (tryEval(_content + filter)) {
                        ++matched;
                    }

                } else if ( 
                    typeof(_content) != 'undefined' 
                    && typeof(_content) !== 'object' 
                    && _content === filter
                    && !searchOptions
                    ||
                    typeof(_content) != 'undefined' 
                    && typeof(_content) !== 'object' 
                    && _content === filter
                    && typeof(searchOptions[field]) == 'undefined'
                ) {

                    ++matched;
                } else if ( 
                    typeof(_content) != 'undefined' 
                    && typeof(_content) !== 'object' 
                    && searchOptions
                    && typeof(searchOptions[field]) != 'undefined'
                ) {
                    
                    reValidCount    = 0;
                    searchOptCount  = searchOptions[field].count();
                    for ( var rule in searchOptions[field]) {
                        searchOptionRules[rule][searchOptions[field][rule]].re = searchOptionRules[rule][searchOptions[field][rule]].re.replace(/\%s/, filter);
                        
                        if (searchOptionRules[rule][searchOptions[field][rule]].modifiers) {
                            re = new RegExp(searchOptionRules[rule][searchOptions[field][rule]].re, searchOptionRules[rule][searchOptions[field][rule]].modifiers);   
                        } else {
                            re = new RegExp(searchOptionRules[rule][searchOptions[field][rule]].re);
                        }
                        
                        if ( re.test(_content) ) {
                            ++reValidCount
                        }
                    }
                    
                    if (reValidCount == searchOptCount) {
                        ++matched;    
                    }
                }

                return {
                    matched: matched
                }
            }

            var searchThroughProp = function(filter, f, _content, matched) {

                var field = f.split(/\./g);
                field = field[field.length - 1];
                re = new RegExp('("' + field + '":\\w+)');
                
                //var value = JSON.stringify(_content).match(re);
                var value = null;
                
                //     value = JSON.stringify(_content).match(re);
                
                try {
                    if ( _content )
                        value = eval('_content.'+f);
                } catch (err) {
                    // Nothing to do
                    // means that the field is not available in the collection
                } 
                
                                   

                if (value /** && value.length > 0*/) {
                    if ( Array.isArray(value) )
                        value = value[1].split(/:/)[1];
                    else if ( typeof(value) == 'string' && /\:/.test(value) )
                        value = value.split(/:/)[1];
                    
                    
                    if (/(<|>|=)/.test(filter)) {

                        // looking for a datetime ?
                        if (
                            /(\d{4})\-(\d{2})\-(\d{2})(\s+|T)(\d{2}):(\d{2}):(\d{2})/.test(value)
                            && /(\d{4})\-(\d{2})\-(\d{2})(\s+|T)(\d{2}):(\d{2}):(\d{2})/.test(filter)
                        ) {

                            if (tryEval(value.replace(/(\d{4})\-(\d{2})\-(\d{2})(\s+|T)(\d{2}):(\d{2}):(\d{2})/, 'new Date("$&")') + filter.replace(/(\d{4})\-(\d{2})\-(\d{2})(\s+|T)(\d{2}):(\d{2}):(\d{2})/, 'new Date("$&")'))) {

                                ++matched;
                            }

                        } else if (tryEval(value + filter)) {

                            ++matched;
                        }

                    } else {
                        if (value == filter) {
                            ++matched;
                        }
                    }

                }

                return {
                    matched: matched
                }
            }

            // if one of the entry matches the given filter, tag the whole entry as matched
            var searchWithin = function(filter, f, _content, matched, i) {
                
                var collectionName  = null
                    , collection    = null
                    , arr           = null
                    , field         = null;

               
                arr = f.split(/\[\*\]/g);
                collectionName = arr[0].replace(/\[\*\]/, '');// only take the first collection
                collection = _content[ collectionName ];
                
                
                field = arr[1];
                if (/^\./.test(field) )
                    field = field.substr(1);

                var subMatched = 0;
                if (collection) {
                    
                    for (var c = 0, cLen = collection.length; c < cLen; ++c) {
                        // cases with _filter.prop
                        if (/\./.test(field)) {

                            searchResult = searchThroughProp(filter, field, collection[c], subMatched);
                            subMatched = searchResult.matched;

                        } else { // normal case

                            searchResult = search(filter, field, collection[c], subMatched, searchOptionRules);
                            subMatched = searchResult.matched;
                        }

                        if (subMatched > 0) break;
                    }
                }
                
                return {
                    matched: (matched + subMatched)
                }
            }

            

            for (var o in tmpContent) {

                if (!tmpContent[o]) {
                    tmpContent[o] = {}
                }
                
                if (!/undefined|function/.test(typeof (tmpContent[o]))) {
                    for (var l = 0, lLen = filters.count(); l<lLen; ++l) {
                        filter = filters[l];
                        condition = filter.count();

                        matched = 0;
                        for (var f in filter) {
                            if ( typeof(filter[f]) == 'undefined' ) throw new Error('filter `'+f+'` cannot be left undefined');

                            localeLowerCase = ( filter[f] !== null && !/(boolean|number)/.test(typeof(filter[f])) ) ? filter[f].toLocaleLowerCase() : filter[f];
                            
                            // cases with tmpContent.prop
                            if (/\./.test(f)) {
                                //JSON.stringify(tmpContent[o]).match(/("gross":\w+)/)[1].split(/:/)[1]

                                // detect if array|collection case
                                if (/\[\*\]/.test(f)) {

                                    searchResult = searchWithin(filter[f], f, tmpContent[o], matched, 0);
                                    matched = searchResult.matched;

                                } else {

                                    searchResult = searchThroughProp(filter[f], f, tmpContent[o], matched);
                                    matched = searchResult.matched;
                                }

                            } else { // normal case

                                searchResult = search(filter[f], f, tmpContent[o][f], matched, searchOptionRules);
                                matched = searchResult.matched;
                            }
                        }

                        if (matched == condition) { // all conditions must be fulfilled to match                           

                            result[i] = tmpContent[o];                            
                            ++i;
                        }

                    }
                }
            }
        } else {
            result = content
        }

        // reset localSearchOptions for nest calls
        localSearchOptions = null;
        
        // TODO - remove this
        if (withOrClause) {
            // merging with previous result (this)
            result  = merge(this, result, true)
        }

        // chaining
        //result._options         = instance._options;
        //result.setSearchOption  = instance.setSearchOption;
        
        result.insert           = instance.insert;
        result.notIn            = instance.notIn;
        result.find             = this.find;
        result.update           = instance.update;
        result.replace          = instance.replace;
        result.or               = instance.or;
        result.findOne          = instance.findOne;
        result.limit            = instance.limit;
        result.orderBy          = instance.orderBy;
        result.delete           = instance.delete;
        result.toRaw            = instance.toRaw;

        return result
    }
    
    /** 
     * findOne
     * 
     * E.g.: 
     *  - new Collection(projects).findOne({name: 'My Project'})
     *  - new Collection(projects)
     *              .setSearchOption({name: { isCaseSensitive: false }})
     *              .findOne({name: 'my project'})
     * 
     * 
     * Available options :
     *  isCaseSensitive: [true|false] - set to true by default
     * 
     * @param {object} filter
     * 
     * @return {object} result
     * 
    */
   instance['findOne'] = function() {
    var key         = null // comparison key
        , result    = null
        , filters   = null
        //, uuidSearchModeEnabled = true
    ;

    if ( typeof(arguments[arguments.length-1]) == 'string' ) {
        key = arguments[arguments.length - 1];
        delete arguments[arguments.length - 1];
    }
    
    // if ( typeof(arguments[arguments.length-1]) == 'boolean' ) {
    //     uuidSearchModeEnabled = arguments[arguments.length - 1]
    //     delete arguments[arguments.length - 1];
    // }
    
    if (arguments.length > 0) {
        filters = arguments;
    }
    

    if ( typeof(filters) == 'undefined' || !filters || typeof(filters) != 'object' ) {
        throw new Error('[ Collection ][ findOne ] `filters` argument must be defined: Array or Filter Object(s) expected');
    }

    // If an operation (find, insert ...) has been executed, get the previous result; if not, get the whole collection
    //var currentResult = JSON.parse(JSON.stringify((Array.isArray(this)) ? this : content));
    var currentResult = null;
    var foundResults = null;
    if ( Array.isArray(arguments[0]) ) {
        foundResults = arguments[0];
    } else {
        foundResults = instance.find.apply(this, arguments) || [];
    }
    
    if (foundResults.length > 0) {
        currentResult = foundResults.limit(1).toRaw()[0];            
    }

    result          = currentResult;
    return result
}
// instance['findOne'] = function(filter, options) {
    
//     if ( typeof(filter) !== 'object' ) {
//         throw new Error('filter must be an object');
//     } else {
        
//         var condition = filter.count()
//             , i                 = 0
//             , tmpContent        = Array.isArray(this) ? this : JSON.parse(JSON.stringify(content))
//             , result            = []
//             , localeLowerCase   = '';

//         var re          = null
//         , reValidCount  = null
//         , searchOptCount = null;

//         var optionsRules = {
//             isCaseSensitive: {
//                 false: {
//                     re: '^%s$',
//                     modifiers: 'i'
//                 },
//                 true: {
//                     re: '^%s$'
//                 }
//             }
//         }

//         if (condition == 0) return null;

//         for (var o in tmpContent) {
//             for (var f in filter) {
//                 if ( typeof(filter[f]) == 'undefined' ) throw new Error('filter `'+f+'` cannot be left undefined');

//                 localeLowerCase = ( !/(boolean|number)/.test(typeof(filter[f])) ) ? filter[f].toLocaleLowerCase() : filter[f];
//                 // NOT NULL case
//                 if ( filter[f] && keywords.indexOf(localeLowerCase) > -1 && localeLowerCase == 'not null' && typeof(tmpContent[o][f]) != 'undefined' && typeof(tmpContent[o][f]) !== 'object' && tmpContent[o][f] === filter[f] && tmpContent[o][f] != 'null' && tmpContent[o][f] != 'undefined' ) {
//                     if (result.indexOf(tmpContent[o][f]) < 0 ) {
//                         ++i;
//                         if (i === condition) result = tmpContent[o]
//                     }

//                 } else if ( typeof(tmpContent[o][f]) != 'undefined' && typeof(tmpContent[o][f]) !== 'object' ) {
                    
//                     if ( typeof(options) != 'undefined' && typeof(options[f]) != 'undefined'  ) {
//                         reValidCount    = 0;
//                         searchOptCount  = options[f].count();
                        
//                         for (var opt in options[f]) {
//                             optionsRules[opt][options[f][opt]].re = optionsRules[opt][options[f][opt]].re.replace(/\%s/, filter[f]);

//                             if (optionsRules[opt][options[f][opt]].modifiers) {
//                                 re = new RegExp(optionsRules[opt][options[f][opt]].re, optionsRules[opt][options[f][opt]].modifiers);   
//                             } else {
//                                 re = new RegExp(optionsRules[opt][options[f][opt]].re);
//                             }
                            
//                             if ( re.test(tmpContent[o][f]) ) {
//                                 ++reValidCount
//                             }
//                         }

//                         if (reValidCount == searchOptCount) {
//                             ++i;
//                             if (i === condition) result = tmpContent[o]
//                         }
//                     } else if ( tmpContent[o][f] === filter[f] ) { // normal case
//                         ++i;
//                         if (i === condition) result = tmpContent[o]
//                     }
                    
//                 } else if ( filter[f] === null && tmpContent[o][f] === null ) { // NULL case
//                     ++i;
//                     if (i === condition) result = tmpContent[o]
//                 }
//             }
//         }
//     }

//     result.toRaw = instance.toRaw;

//     return ( Array.isArray(result) && !result.length ) ? null : result
// }

    instance['or'] = function () {
        arguments[arguments.length] = true;
        ++arguments.length;

        return instance.find.apply(this, arguments);
    }

    instance['limit'] = function(resultLimit) {
        if ( typeof(resultLimit) == 'undefined' || typeof(resultLimit) != 'number' ) {
            throw new Error('[Collection::result->limit(resultLimit)] : `resultLimit` parametter must by a `number`')
        }

        var result = Array.isArray(this) ? this : JSON.parse(JSON.stringify(content));

        //resultLimit
        result = result.splice(0, resultLimit);

        // chaining
        result.insert   = instance.insert;
        result.update   = instance.update;
        result.replace  = instance.replace;
        result.notIn    = instance.notIn;
        result.findOne  = instance.findOne;
        result.orderBy  = instance.orderBy;
        result.delete   = instance.delete;
        result.toRaw    = instance.toRaw;

        return result
    }
    
    /** 
     * notIn
     * Works like a filter to match results by `excluding` through given `filters` !!
     * 
     *  filter can be like 
     *      { car: 'toyota' }
     *      { car: 'toyota', color: 'red' }
     *      
     *  You can pass more than one filter
     *      { car: 'toyota', color: 'red' }, { car: 'porche' }
     * 
     * .notIn(filter) // AND syntax
     * .notIn(filter1, filter2, filter3) // OR syntax
     * .notIn(filter, 'id') where `id` is the uuid used for the DIFF - `_uuid
     * 
     * By default, Collection use its own internal `_uuid` to search and compare.
     * This mode is called `uuidSearchModeEnabled`, and it is by default set to `true`.
     * If you want to disable this mode in order to MATCH/DIFF by forcing check on every single filter
     * of the resultset :
     *      .notIn(filter, false) where false must be a real boolean
     * 
     * 
     * 
     * @param {object|array} filters|arrayToFilter - works like find filterss
     * @param {string} [key] - unique id for comparison; faster when provided
    */
    instance['notIn'] =  function(){

        var arrayToFilter           = null // [] those that we don't want in the result
            , key                   = null //  string comparison key
            , result                = null
            , filters               = null
            , uuidSearchModeEnabled = true
        ;

        if ( typeof(arguments[arguments.length-1]) == 'string' ) {
            key = arguments[arguments.length - 1];
            delete arguments[arguments.length - 1];
        }
        
        if ( typeof(arguments[arguments.length-1]) == 'boolean' ) {
            uuidSearchModeEnabled = arguments[arguments.length - 1]
            delete arguments[arguments.length - 1];
        }
        
        if (arguments.length > 0) {
            filters = arguments;
        }
        

        if ( typeof(filters) == 'undefined' || !filters || typeof(filters) != 'object' ) {
            throw new Error('[ Collection ][ notIn ] `filters` argument must be defined: Array or Filter Object(s) expected');
        }

        // If an operation (find, insert ...) has been executed, get the previous result; if not, get the whole collection
        var currentResult = JSON.parse(JSON.stringify( (Array.isArray(this)) ? this : content) );
        
        var foundResults = null;
        if ( Array.isArray(arguments[0]) ) {
            foundResults    = arguments[0];
        } else {
            foundResults    = instance.find.apply(this, arguments) || [];
        }
        
        if (foundResults.length > 0) {
            // check key
            if ( 
                uuidSearchModeEnabled
                && key 
                && typeof(foundResults[0]) == 'undefined' 
                && typeof(foundResults[0][key]) == 'undefined' 
            ) {
                throw new Error('[ Collection ][ notIn ] `key` not valid');
            } else if ( uuidSearchModeEnabled && !key && typeof(foundResults[0]['_uuid']) != 'undefined' ) {
                key = '_uuid'
            }

            // fast search with key
            var r       = 0
                , rLen  = foundResults.length
                , c     = 0
                , cLen  = currentResult.length
                , f     = 0
                , fLen  = filters.count()
                , keyLen    = null
                , matched = 0
                , fullFiltersMatched = 0
            ;
            if ( uuidSearchModeEnabled && typeof(currentResult[c]) != 'undefined' && currentResult[c].hasOwnProperty(key) ) {
                // for every single result found        
                for (; r < rLen; ++r) {
                    
                    if (!currentResult.length) break;
                    
                    c = 0; cLen = currentResult.length;
                    for (; c < cLen; ++c) {
                        if ( typeof(currentResult[c]) == 'undefined' || typeof(foundResults[r]) == 'undefined' ) {
                            continue
                        }
                        // when matched, we want to remove those not in current result                        
                        if (currentResult[c][key] === foundResults[r][key]) {
                            currentResult.splice(c,1);
                            break;
                        }
                    }
                }
            } else if ( typeof(currentResult[c]) == 'undefined' ) { //empty source case
                // means that since we don't have a source to compare, current === found
                currentResult = JSON.parse(JSON.stringify(foundResults));                
                
            } else { // search based on provided filters
                // for every single result found        
                for (; r < rLen; ++r) {
                    if (!currentResult.length) break;                    
                    
                    //onRemoved:
                    c = 0; cLen = currentResult.length;
                    for (; c < cLen; ++c) { // current results                        
                
                        if (typeof (currentResult[c]) != 'undefined') {
                            
                            // for each filter
                            fullFiltersMatched = 0;  
                            f = 0;  
                            for (; f < fLen; ++f ) {
                                if ( typeof(filters[f]) == 'undefined' ) throw new Error('filter `'+f+'` cannot be left undefined');
                                
                                keyLen = filters[f].count();
                                matched = 0;
                                for (key in filters[f]) {
                                    if ( currentResult[c].hasOwnProperty(key) && currentResult[c][key] === foundResults[r][key] ) {
                                        ++matched;
                                    }   
                                }    
                                if (matched == keyLen) {
                                    ++fullFiltersMatched
                                }              
                            }
                            
                            if (fullFiltersMatched) {
                                currentResult.splice(c,1);
                                //break onRemoved;
                                break;
                            }
                            
                        }
                    }
                }
            }   
                
        } 

        result          = currentResult;
        result.notIn    = instance.notIn;
        result.limit    = instance.limit;
        result.find     = instance.find;
        result.findOne  = instance.findOne;
        result.insert   = instance.insert;
        result.replace  = instance.replace;
        result.update   = instance.update;
        result.orderBy  = instance.orderBy;
        result.delete   = instance.delete;
        result.toRaw    = instance.toRaw;

        return result
    }

    instance['insert'] = function (set) {

        var result = null;
        if ( typeof(set) !== 'object' ) {
            throw new Error('filter must be an object');
        } else {

            var tmpContent = Array.isArray(this) ? this : content;

            // Indexing;
            set._uuid = uuid.v4();
            tmpContent.push(set);

            result = tmpContent;
        }

        // chaining
        result.limit    = instance.limit;
        result.find     = instance.find;
        result.findOne  = instance.findOne;
        result.update   = instance.update;
        result.replace  = instance.replace;
        result.orderBy  = instance.orderBy;
        result.notIn    = instance.notIn;
        result.delete   = instance.delete;
        result.toRaw    = instance.toRaw;

        return result
    }

    /**
     * update
     * 
     * @param {object} filter
     * @param {object} set
     * 
     * @return {objet} instance
     */    
    instance['update'] = function() {
        var key         = null // comparison key
            , result    = null
            , filters   = null
            , set       = null
            //, uuidSearchModeEnabled = true
        ;

                
        if ( typeof(arguments[arguments.length-1]) == 'string' ) {
            key = arguments[arguments.length - 1];
            delete arguments[arguments.length - 1];
        } 
        
        if ( typeof(arguments[arguments.length-1]) == 'object' ) {
            set = arguments[arguments.length - 1];
            delete arguments[arguments.length - 1];
        }
        
        // if ( typeof(arguments[arguments.length-1]) == 'boolean' ) {
        //     uuidSearchModeEnabled = arguments[arguments.length - 1]
        //     delete arguments[arguments.length - 1];
        // }
        
        if (arguments.length > 0) {
            filters = arguments;
        }
        

        if ( typeof(filters) == 'undefined' || !filters || typeof(filters) != 'object' ) {
            throw new Error('[ Collection ][ update ] `filters` argument must be defined: Array or Filter Object(s) expected');
        }
        
        if ( typeof(set) == 'undefined' || !set || typeof(set) != 'object' ) {
            throw new Error('[ Collection ][ update ] `set` argument must be defined: Object expected');
        }

        // If an operation (find, insert ...) has been executed, get the previous result; if not, get the whole collection
        //var currentResult = JSON.parse(JSON.stringify((Array.isArray(this)) ? this : content));
        var currentResult = null;
        var foundResults = null;
        if ( Array.isArray(arguments[0]) ) {
            foundResults = arguments[0];
        } else {
            foundResults = instance.find.apply(this, arguments) || [];
        }
        
        result = Array.isArray(this) ? this : JSON.parse(JSON.stringify(content));
        if (foundResults.length > 0 ) {          
            var arr = foundResults.toRaw();
            for (var a = 0, aLen = arr.length; a < aLen; ++a) {                
                arr[a] = merge( JSON.parse(JSON.stringify(set) ), arr[a]);
                for (var r = 0, rLen = result.length; r < rLen; ++r) {
                    if ( result[r].id == arr[a].id ) {
                        result[r] = arr[a];
                        break;
                    }
                }
            }            
        }

        // chaining
        result.limit    = instance.limit;
        result.find     = instance.find;
        result.findOne  = instance.findOne;
        result.insert   = instance.insert;
        result.update   = instance.update;
        result.replace  = instance.replace;
        result.orderBy  = instance.orderBy;
        result.notIn    = instance.notIn;
        result.delete   = instance.delete;
        result.toRaw    = instance.toRaw;

        return result
    }
    
    
    instance['replace'] = function() {
        var key         = null // comparison key
            , result    = null
            , filters   = null
            , set       = null
            //, uuidSearchModeEnabled = true
        ;

                
        if ( typeof(arguments[arguments.length-1]) == 'string' ) {
            key = arguments[arguments.length - 1];
            delete arguments[arguments.length - 1];
        } 
        
        if ( typeof(arguments[arguments.length-1]) == 'object' ) {
            set = arguments[arguments.length - 1];
            delete arguments[arguments.length - 1];
        }
        
        // if ( typeof(arguments[arguments.length-1]) == 'boolean' ) {
        //     uuidSearchModeEnabled = arguments[arguments.length - 1]
        //     delete arguments[arguments.length - 1];
        // }
        
        if (arguments.length > 0) {
            filters = arguments;
        }
        

        if ( typeof(filters) == 'undefined' || !filters || typeof(filters) != 'object' ) {
            throw new Error('[ Collection ][ update ] `filters` argument must be defined: Array or Filter Object(s) expected');
        }
        
        if ( typeof(set) == 'undefined' || !set || typeof(set) != 'object' ) {
            throw new Error('[ Collection ][ update ] `set` argument must be defined: Object expected');
        }

        // If an operation (find, insert ...) has been executed, get the previous result; if not, get the whole collection
        //var currentResult = JSON.parse(JSON.stringify((Array.isArray(this)) ? this : content));
        var currentResult = null;
        var foundResults = null;
        if ( Array.isArray(arguments[0]) ) {
            foundResults = arguments[0];
        } else {
            foundResults = instance.find.apply(this, arguments) || [];
        }
        
        result = Array.isArray(this) ? this : JSON.parse(JSON.stringify(content));
        if (foundResults.length > 0 ) {          
            var arr = foundResults.toRaw();
            for (var a = 0, aLen = arr.length; a < aLen; ++a) {                
                arr[a] = JSON.parse(JSON.stringify(set));
                for (var r = 0, rLen = result.length; r < rLen; ++r) {
                    if ( result[r].id == arr[a].id ) {
                        result[r] = arr[a];
                        break;
                    }
                }
            }            
        }

        // chaining
        result.limit    = instance.limit;
        result.find     = instance.find;
        result.findOne  = instance.findOne;
        result.insert   = instance.insert;
        result.update   = instance.update;
        result.replace  = instance.replace;
        result.orderBy  = instance.orderBy;
        result.notIn    = instance.notIn;
        result.delete   = instance.delete;
        result.toRaw    = instance.toRaw;

        return result
    }
    
    /**
     * .delete({ key: 2 })
     * .delete({ name: 'Jordan' }, 'id') where id will be use as the `uuid` to compare records
     * 
     * AND syntax
     * .delete({ car: 'toyota', color: 'red' })
     * 
     * OR syntax
     * .delete({ car: 'toyota', color: red }, { car: 'ford' } ) // will delete all `toyota red cars` & all `ford cars`
     * 
     *  N.B.: will not affect current result - just returning the DIFF
     *  If you
     * @param {object} filter - samme as `.find(filter)`
     * @param {string|boolean} [ uuid | disabled ] - by default, Collection is using its internal _uuid
     * If you want to delete without key comparison, disable `uuid` search mode
     * .delete({ name: 'Jordan' }, false)
     * 
     * @return {array} result
     */
    instance['delete'] = function() {

        var result = instance.notIn.apply(this, arguments);

        result.limit = instance.limit;
        result.find = instance.find;
        result.findOne = instance.findOne;
        result.insert = instance.insert;
        result.update = instance.update;
        result.replace = instance.replace;
        result.orderBy = instance.orderBy;
        result.notIn = instance.notIn;
        result.toRaw = instance.toRaw;

        return result
    }


    var sortKeywords = [ 'asc', 'desc' ];
    /**
     * sort
     *
     * @param {object|array} filter
     * */
    instance['orderBy'] = function () {
        
        if ( typeof(arguments) == 'undefined' || arguments.length < 1)
            throw new Error('[ Collection->sort(filter) ] where `filter` must not be empty or null' );
            
        var filter = null;
        if ( arguments.length == 1 ) {
            filter = arguments[0];
        } else {
            // converting arguments into array
            filter = new Array(arguments.length);
            for (var f = 0, fLen = filter.length; f < fLen; ++f) {
                filter[f] = arguments[f]
            }
        }

        var variableContent = (Array.isArray(this)) ? this : JSON.parse(JSON.stringify(content));
        return sortResult(filter, variableContent.toRaw())
    }

    /**
     * sortResult
     * ref.:
     *  https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort
     *  https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/localeCompare#Browser_compatibility
     *
     * e.g.:
     *  .orderBy({ name: 'asc' })
     *
     *  // overriding filters -> last filter is always right
     *  .orderBy([ { updatedAt : 'desc'}, { name: 'asc' } ])
     * 
     *  // sorting boolean 
     *  .orderBy({ isActive: 'desc'}) => will display all active(TRUE) first
     *  NB.: Boolean are 0 (FALSE) or 1 (TRUE)
     * 
     *  // combining filters -> the first one is always right
     *  .orderBy({ updatedAt : 'desc'}, { name: 'asc' })
     *
     * @param {object|array} filter
     * */
    var sortResult = function (filter, content) {
        if ( typeof(filter) != 'object') {
            throw new Error('`filter` parametter must be an object or an array')
        }

        var condition           = filter.count()
            , sortOp            = {}
            , key               = null
            , prop              = null
            , result            = []
            ;

        if (condition == 0) return null;


        // asc
        sortOp['asc'] = function (prop, content) {

            var mapped = content.map(function(obj, i) {
                var _m = {};
                _m.index = i;
                _m[prop] = obj[prop];
                return _m;
            });
            
            mapped.sort(function onAscSort(a, b) {    
                
                
                var _compare = function(a, b) {
                    // handle booleans
                    if ( /^(true|false)$/i.test(a) ) {
                        a = ( /true/i.test(a) ) ? 1 : 0;
                    }
                    
                    if ( /^(true|false)$/i.test(b) ) {
                        b = ( /true/i.test(b) ) ? 1 : 0;
                    }
                    
                    
                    if ( typeof(a) == 'string' && a != '' ||  typeof(b) == 'string' ) {
                        
                        if ( typeof(a) == 'number' ) {
                            a = ''+a; // cast to string
                        } 
                        if ( typeof(b) == 'number' ) {
                            b = ''+b; // cast to string
                        } 
                        
                        return a.localeCompare(b, undefined, {sensitivity: 'case', caseFirst: 'upper'})
                    }
                    
                    if (a > b) {
                        return 1;
                    }
                    if (a < b) {
                        return -1;
                    }
                    // a must be equal to b
                    return 0;                    
                }
                
                
                if ( typeof(a) == 'object' ) {
                    return _compare(a[prop], b[prop])
                }
                
                return _compare(a, b)
                    
            });
            
            return mapped.map(function(m, index, result){
                return content[m.index];
            });
        }

        // desc
        sortOp['desc'] = function (prop, content) {
            return sortOp['asc'](prop, content).reverse()
        }

        multiSortOp = function(content, filter) {
            
            var props = [], keys = [];
            
            if ( Array.isArray(filter) ) {
                for (var f = 0, fLen = filter.length; f < fLen; ++f) {
                    props[f] = Object.keys(filter[f])[0];
                    keys[f] = filter[f][ props[f]] ;     
                }
            } else {
                var f = 0;
                for (var flt in filter) {
                    props[f] = flt;
                    keys[f] = filter[flt] ;  
                    ++f;
                }
            }
            
            

            sortRecursive = function(a, b, columns, order_by, index) {

                var direction = order_by[index] == 'desc' ? 1 : 0;

                var res = null, x = null, y = null;

                if ( typeof(a[columns[index]]) == 'string' && a[columns[index]] != '' ) {

                    res = a[columns[index]].localeCompare(b[columns[index]]);

                    if ( direction == 0 && res != 0 ) {
                        return res < 0 ? -1 : 1
                    } else if (res != 0) {
                        return res < 0 ? 1 : -1
                    }
                    
                    // a must be equal to b
                    return columns.length - 1 > index ? sortRecursive(a, b, columns, order_by, index + 1) : 0;

                } else if (typeof (a[columns[index]]) == 'number' || typeof(b[columns[index]]) == 'number' ) {

                    res = (''+ a[columns[index]]).localeCompare((''+ b[columns[index]]), undefined, { numeric: true });

                    if (direction == 0 && res != 0) {
                        return res < 0 ? -1 : 1
                    } else if (res != 0) {
                        return res < 0 ? 1 : -1
                    }

                    // a must be equal to b
                    return columns.length - 1 > index ? sortRecursive(a, b, columns, order_by, index + 1) : 0;

                } else if ( typeof(a[columns[index]]) == 'boolean' || typeof (b[columns[index]]) == 'boolean' ) {

                    if ( typeof(a[columns[index]]) == 'boolean' ) {
                        x = (a[columns[index]]) ? 1 : 0;
                    }

                    if ( typeof(b[columns[index]]) == 'boolean' ) {
                        y = (b[columns[index]]) ? 1 : 0;
                    }

                    if (x > y) {
                        return direction == 0 ? 1 : -1;
                    }

                    if (x < y) {
                        return direction == 0 ? -1: 1;
                    }

                    // a must be equal to b
                    return columns.length - 1 > index ? sortRecursive(a, b, columns, order_by, index + 1) : 0;

                } else {

                    if (a[columns[index]] > b[columns[index]]) {
                        return direction == 0 ? 1 : -1;
                    }

                    if (a[columns[index]] < b[columns[index]]) {
                        return direction == 0 ? -1 : 1;
                    }
                    // a must be equal to b
                    return columns.length - 1 > index ? sortRecursive(a, b, columns, order_by, index + 1) : 0;
                }
            }

            return content.sort(function onMultiSort(a, b) {
                return sortRecursive(a, b, props, keys, 0);
            });
            // return mapped.map(function(m, index, result){
            //     return content[m.index];
            // });
        }

        if ( Array.isArray(filter) || filter.count() > 1 ) {
            
            result = multiSortOp(content, filter);
            
        } else {
                        
            prop    = Object.keys(filter)[0];
            key     = filter[prop];

            result  = sortOp[key](prop, content);
        }



        // chaining
        result.find     = instance.find;
        result.findOne  = instance.findOne;
        result.limit    = instance.limit;
        result.notIn    = instance.notIn;
        result.insert   = instance.insert;
        result.update   = instance.update;
        result.replace  = instance.replace;
        result.delete   = instance.delete;
        result.orderBy  = instance.orderBy;
        result.toRaw    = instance.toRaw;
        
        return result
    };

    /**
     * toRaw
     * Trasnform result into a clean format (without _uuid)
     *
     * @param {object|array} result
     * */
    instance['toRaw'] = function(result) {

        var result = ( Array.isArray(this) ) ? this : content;
        // cleanup
        for (var i = 0, len = result.length; i < len; ++i) {
            if (result[i]._uuid)
                delete result[i]._uuid;
        }

        return JSON.parse(JSON.stringify(result))
    }

    return instance;
};

if ( ( typeof(module) !== 'undefined' ) && module.exports ) {
    // Publish as node.js module
    module.exports = Collection
} else if ( typeof(define) === 'function' && define.amd) {
    // Publish as AMD module
    define('utils/collection',[],function() { return Collection })
};
/*
 * This file is part of the gina package.
 * Copyright (c) 2017 Rhinostone <gina@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
// if (typeof (module) !== 'undefined' && module.exports) {
    
//     var lib = null;
//     if ( typeof( getPath('gina') ) != 'undefined' ) {
//         lib     = require(getPath('gina').lib);
//     } else {
//         lib     = require('../../index');
//     }
    
//     var console = lib.logger;
//     //var merge   = lib.merge;
// }


/**
 * Routing
 *
 * @package     Gina.Lib
 * @namespace   Gina.Lib.Routing
 * @author      Rhinostone <gina@rhinostone.com>
 * */

function Routing() {

    var self        = {};    
    var isGFFCtx    = ((typeof (module) !== 'undefined') && module.exports) ? false :  true;
    
    self.allowedMethods         = ['get', 'post', 'put', 'delete'];
    self.allowedMethodsString   = self.allowedMethods.join(',');
    
    // loading plugins
    var plugins = null, Validator = null;
    if (!isGFFCtx) {
        plugins = require(__dirname+'/../../../core/plugins') || getContext('gina').plugins;
        Validator = plugins.Validator;
    }
    
    
    /**
     * Load bundle routing configuration
     * 
     * @param {object} options
     *  {
     *      isStadalone: false,
     *      bundle: 'default',   // bundle's name
     *      wroot: '/',          // by default
     *      
     *  }
     * 
     */
    self.loadBundleRoutingConfiguration = function(options, filename) {
        
    }
    
    /**
     * Get routing
     * 
     * @param {string} [bundle]
     */
    self.getRouting = function(bundle) {
        
    }
    
    /**
     * Get reversed routing
     * 
     * @param {string} [bundle]
     */
    self.getReverseRouting = function(bundle) {
        
    }

    /**
     * Compare urls
     *
     * @param {object} params - Route params containing the given url to be compared with
     * @param {string|array} url - routing.json url
     * @param {object} [request]
     *
     * @return {object|false} foundRoute
     * */
    self.compareUrls = function(params, url, request) {
        
        if ( typeof(request) == 'undefined' ) {
            request = { routing: {} }
        }

        if ( /\,/.test(url) ) {
            var i               = 0
                , urls          = url.split(/\,/g)
                , len           = urls.length
                , foundRoute    = {
                    past: false,
                    request: request
                };


            while (i < len && !foundRoute.past) {
                foundRoute = parseRouting(params, urls[i], request);
                //if ( foundRoute.past ) break;
                ++i
            }

            return foundRoute
        } else {
            return parseRouting(params, url, request)
        }
    }

    /**
     * Check if rule has params
     *
     * @param {string} pathname
     * @return {boolean} found
     *
     * @private
     * */
    var hasParams = function(pathname) {
        return (/:/.test(pathname)) ? true : false
    }

    /**
     * Parse routing for mathcing url
     *
     * @param {object} params
     * @param {string} url
     * @param {object} request
     *
     * @return {object} foundRoute
     *
     * */
    var parseRouting = function(params, url, request) {

        var uRe             = params.url.split(/\//)
            , uRo           = url.split(/\//)
            , uReCount      = 0
            , uRoCount      = 0
            , maxLen        = uRo.length
            , score         = 0
            , foundRoute    = {}
            , i             = 0
        ;
        
        //attaching routing description for this request
        //request.routing = params; // can be retried in controller with: req.routing
        
        if ( typeof(params.requirements) != 'undefined' && typeof(request.get) != 'undefined' ) {            
            for (var p in request.get) {
                if ( typeof(params.requirements[p]) != 'undefined' && uRo.indexOf(':' + p) < 0 ) {
                    uRo[uRoCount] = ':' + p; ++uRoCount;
                    uRe[uReCount] = request.get[p]; ++uReCount;
                    ++maxLen;
                }
            }
        }
        
        if (uRe.length === uRo.length) {
            for (; i < maxLen; ++i) {
                if (uRe[i] === uRo[i]) {
                    ++score
                } else if (score == i && hasParams(uRo[i]) && fitsWithRequirements(uRo[i], uRe[i], params, request)) {
                    ++score
                }
            }
        }

        foundRoute.past     = (score === maxLen) ? true : false;
        
        if (foundRoute.past) {
            //attaching routing description for this request
            request.routing = params; // can be retried in controller with: req.routing
            foundRoute.request  = request;
        }
        

        return foundRoute
    }

    /**
     * Fits with requiremements
     * http://en.wikipedia.org/wiki/Regular_expression
     *
     * @param {string} urlVar
     * @param {string} urlVal
     * @param {object} params
     *
     * @return {boolean} true|false - `true` if it fits
     *
     * @private
     * */
    var fitsWithRequirements = function(urlVar, urlVal, params, request) {
        //var isValid = new Validator('routing', { email: "m.etouman@wics"}, null, {email: {isEmail: true}} ).isEmail().valid;
        var matched     = -1
            , _param    = urlVar.match(/\:\w+/g)
            , regex     = new RegExp(urlVar, 'g')
            //, regex     = eval('/' + urlVar.replace(/\//g,'\\/') +'/g')
            , re        = null
            , flags     = null
            , key       = null
            , tested    = false
            
            , _validator    = null
            , _data         = null
            , _ruleObj      = null
            , _rule         = null
            , rule          = null
            , str           = null
        ;
        
        if (!_param.length) return false;

        //  if custom path, path rewrite
        if (params.param.path && regex.test(params.param.path)) {
            params.param.path = params.param.path.replace(regex, urlVal);
        }
        
        //  if custom namespace, namespace rewrite
        if (params.param.namespace && regex.test(params.param.namespace)) {            
            params.param.namespace = params.param.namespace.replace(regex, urlVal);            
        }
        
        //  if custom file, file rewrite
        if (params.param.file && regex.test(params.param.file)) {            
            params.param.file = params.param.file.replace(regex, urlVal);            
        }

        //  if custom title, title rewrite
        if (params.param.title && regex.test(params.param.title)) {    
            params.param.title = params.param.title.replace(regex, urlVal);
        }

        if (_param.length == 1) {// fast one
            
            re = new RegExp( _param[0]);
            matched = (_param.indexOf(urlVar) > -1) ? _param.indexOf(urlVar) : false;
            
            if (matched === false ) {
                // In order to support rules defined like :
                //      { params.url }  => `/section/:name/page:number`
                //      { request.url } => `/section/plante/page4`
                //
                //      with keys = [ ":name", ":number" ]
                
                if ( urlVar.match(re) ) {
                    matched = 0;
                }
            }
            

            if (matched === false) return matched;
            // filter on method
            if (params.method.toLowerCase() !== request.method.toLowerCase()) return false;

            key     = _param[matched].substr(1);
            regex   = params.requirements[key];

            if (/^\//.test(regex)) {
                re      = regex.match(/\/(.*)\//).pop();
                flags   = regex.replace('/' + re + '/', '');                

                tested  = new RegExp(re, flags).test(urlVal)
            } else if ( /^validator\:\:/.test(regex) ) {
                /**
                 * "requirements" : {
                 *      "id" : "/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i",
                 *      "email": "validator::{ isEmail: true, isString: [7] }"
                 *  }
                 * 
                 * e.g.: tested = new Validator('routing', _data, null, {email: {isEmail: true}} ).isEmail().valid;
                 */ 
                _data = {}; _ruleObj = {}; _rule = {}; str = '';                
                urlVar.replace( new RegExp('[^'+ key +']','g'), function(){ str += arguments[0]  });                
                _data[key]  = urlVal.replace( new RegExp(str, 'g'), '');
                _ruleObj    = JSON.parse(regex.split(/::/).splice(1)[0].replace(/([^\W+ true false])+(\w+)/g, '"$&"'));       
                _rule[key]  = _ruleObj;                
                _validator  = new Validator('routing', _data, null, _rule );
                
                for (rule in _ruleObj) {
                    if (Array.isArray(_ruleObj[rule])) { // has args
                        _validator[key][rule].apply(_validator[key], _ruleObj[rule])
                    } else {
                        _validator[key][rule](_ruleObj[rule])
                    }                    
                }
                tested = _validator.isValid();
            } else {
                tested = new RegExp(params.requirements[key]).test(urlVal)
            }

            if (
                typeof(params.param[key]) != 'undefined' &&
                typeof(params.requirements) != 'undefined' &&
                typeof(params.requirements[key]) != 'undefined' &&
                typeof(request.params) != 'undefined' &&
                tested
            ) {                
                request.params[key] = urlVal;
                return true
            }

        } else { // slow one

            // In order to support rules defined like :
            //      { params.url }  => `/section/:name/page:number`
            //      { request.url } => `/section/plante/page4`
            //
            //      with keys = [ ":name", ":number" ]

            var keys        = _param
                , tplUrl    = params.url
                , url       = request.url
                , values    = {}
                , strVal    = ''
                , started   = false
                , i         = 0
            ;

            for (var c = 0, posLen = url.length; c < posLen; ++c) {
                if (url.charAt(c) == tplUrl.charAt(i) && !started) {
                    ++i
                    continue
                } else if (strVal == '') { // start

                    started = true;
                    strVal += url.charAt(c);
                } else if (c > (tplUrl.indexOf(keys[0]) + keys[0].length)) {

                    regex = params.requirements[keys[0]];
                    urlVal = strVal.substr(0, strVal.length);

                    if (/^\//.test(regex)) {
                        re      = regex.match(/\/(.*)\//).pop();
                        flags   = regex.replace('/' + re + '/', '');

                        tested = new RegExp(re, flags).test(urlVal)

                    } else if ( /^validator\:\:/.test(regex) ) {
                        /**
                         * "requirements" : {
                         *      "id" : "/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i",
                         *      "email": "validator::{ isEmail: true, isString: [7] }"
                         *  }
                         * 
                         * e.g.: tested = new Validator('routing', _data, null, {email: {isEmail: true}} ).isEmail().valid;
                         */ 
                        _data = {}; _ruleObj = {}; _rule = {}; str = '';                
                        urlVar.replace( new RegExp('[^'+ key[0] +']','g'), function(){ str += arguments[0]  });                
                        _data[key[0]]  = urlVal.replace( new RegExp(str, 'g'), '');
                        _ruleObj    = JSON.parse(regex.split(/::/).splice(1)[0].replace(/([^\W+ true false])+(\w+)/g, '"$&"'));       
                        _rule[key[0]]  = _ruleObj;                
                        _validator  = new Validator('routing', _data, null, _rule );
                        
                        for (rule in _ruleObj) {
                            if (Array.isArray(_ruleObj[rule])) { // has args
                                _validator[key[0]][rule].apply(_validator[key[0]], _ruleObj[rule])
                            } else {
                                _validator[key[0]][rule](_ruleObj[rule])
                            }                    
                        }
                        tested = _validator.isValid();
                    } else {
                        tested = new RegExp(params.requirements[key[0]]).test(urlVal)
                    }

                    if (tested) {
                        values[keys[0].substr(1)] = urlVal
                    } else {
                        return false
                    }

                    strVal = '';
                    started = false;
                    i = (tplUrl.indexOf(keys[0]) + keys[0].length);
                    c -= 1;

                    keys.splice(0, 1)
                } else {
                    strVal += url.charAt(c);
                    ++i
                }

                if (c == posLen - 1) {

                    regex = params.requirements[keys[0]];
                    urlVal = strVal.substr(0, strVal.length);

                    if (/^\//.test(regex)) {
                        re = regex.match(/\/(.*)\//).pop();
                        flags = regex.replace('/' + re + '/', '');

                        tested = new RegExp(re, flags).test(urlVal)

                    } else {
                        tested = new RegExp(params.requirements[key]).test(urlVal)
                    }

                    if (tested) {
                        values[keys[0].substr(1)] = urlVal
                    } else {
                        return false
                    }
                }
            }

            if (values.count() == keys.length) {
                key = null;
                for (key in values) {
                    request.params[key] = values[key];
                }
                return true
            }
        }

        return false
    }

    /**
     * @function getRoute
     *
     * @param {string} rule e.g.: [ <scheme>:// ]<name>[ @<bundle> ][ /<environment> ]
     * @param {object} params
     * @param {number} [urlIndex] in case you have more than one url registered for the current route, you can select the one you want to use. Default is 0.
     *
     * @return {object} route
     * */
    self.getRoute = function(rule, params, urlIndex) {
        
        var config = null;
        if (isGFFCtx) {
            config = window.gina.config
        } else {
            config = getContext('gina').config
            if ( typeof(getContext('argvFilename')) != 'undefined' ) {
                config.getRouting = getContext('gina').Config.instance.getRouting
            }
        }
        
        var env         = config.env || GINA_ENV  // by default, takes the current bundle
            , envTmp    = null
            , scheme    = null
            , bundle    = config.bundle // by default, takes the current bundle
        ;
        
        if ( !/\@/.test(rule) && typeof(bundle) != 'undefined' && bundle != null) {
            rule += '@' + bundle
        }

        if ( /\@/.test(rule) ) {

            var arr = ( rule.replace(/(.*)\:\/\//, '') ).split(/\@/);

            bundle  = arr[1];

            // getting env
            if ( /\/(.*)$/.test(rule) ) {
                envTmp  = ( rule.replace(/(.*)\:\/\//, '') ).split(/\/(.*)$/)[1];
                bundle  = bundle.replace(/\/(.*)$/, '');
                env     = envTmp || env;
            }


            // getting scheme
            //scheme = ( /\:\/\//.test(rule) ) ? rule.split(/\:\/\//)[0] : config.bundlesConfiguration.conf[bundle][env].server.scheme;

            rule = arr[0] +'@'+ bundle;
        }
        
        
        var routing = config.getRouting(bundle, env);

        if ( typeof(routing[rule]) == 'undefined' ) {
            throw new Error('[ RoutingHelper::getRouting(rule, params) ] : `' +rule + '` not found !')
        }

        var route = JSON.parse(JSON.stringify(routing[rule]));
        var variable    = null
            , regex     = null
            , urls      = null
            , i         = null
            , len       = null
        ;
        
        var replacement = function(matched){
            return ( /\/$/.test(matched) ? replacement.variable+ '/': replacement.variable )            
        }
        
        for (var p in route.param) {
            if ( /^:/.test(route.param[p]) ) {
                variable = route.param[p].substr(1);
                
                if ( typeof(params) != 'undefined' && typeof(params[variable]) != 'undefined' ) {
                    
                    regex = new RegExp('(:'+variable+'/|:'+variable+'$)', 'g');                   
                    

                    if ( typeof(route.param.path) != 'undefined' && /:/.test(route.param.path) ) {
                        route.param.path = route.param.path.replace( regex, params[variable]);
                    }
                    if (typeof (route.param.title) != 'undefined' && /:/.test(route.param.title)) {
                        route.param.title = route.param.title.replace( regex, params[variable]);
                    }
                    if (typeof (route.param.namespace) != 'undefined' && /:/.test(route.param.namespace)) {
                        route.param.namespace = route.param.namespace.replace( regex, params[variable]);
                    }
                    if (typeof (route.param.file) != 'undefined' && /:/.test(route.param.file)) {
                        route.param.file = route.param.file.replace( regex, params[variable]);
                    }
                                        
                    if ( /\,/.test(route.url) ) {                        
                        urls = route.url.split(/\,/g);
                        i = 0; len = urls.length;
                        for (; i < len; ++i) {
                            replacement.variable = params[variable]; 
                            urls[i] = urls[i].replace( regex, replacement );
                        }
                        route.url = urls.join(',');
                    } else {        
                        replacement.variable = params[variable];        
                        route.url = route.url.replace( regex, replacement );
                    }
                }
            }
        }

        if ( /\,/.test(route.url) ) {
            urlIndex = ( typeof(urlIndex) != 'undefined' ) ? urlIndex : 0;
            route.url = route.url.split(/,/g)[urlIndex]
        }

        route.toUrl = function (ignoreWebRoot) {

            // var conf        = config.bundlesConfiguration.conf[bundle][env]
            //     , wroot     = conf.server.webroot
            // ;
            
            var wroot       = this.webroot
                , hostname  = this.hostname
            ;
            
            this.url = ( typeof(ignoreWebRoot) != 'undefined' && ignoreWebRoot == true ) ? path.replace(wroot, '/') : this.url;

            return hostname + this.url
        };
        
        /**
         * request current url
         * 
         * @param {boolean} [ignoreWebRoot]
         * @param {object} [options] - see: https://nodejs.org/api/https.html#https_new_agent_options
         * 
         * @callback {callback} [cb] - see: https://nodejs.org/api/https.html#https_new_agent_options
         *      @param {object} res
         */
        route.request = function(ignoreWebRoot, options, cb) {
            
            var wroot       = this.webroot
                , hostname  = this.hostname
                , url       = ( typeof(ignoreWebRoot) != 'undefined' && ignoreWebRoot == true ) ? path.replace(wroot, '/') : this.url
            ;
            
            var scheme = ( /^https/.test(hostname) ) ? 'https' : 'http';
            
            if (isGFFCtx) {
                var target = ( typeof(options) != 'undefined' && typeof(options.target) != 'undefined' ) ? options.target : "_self";
                window.open(url, target)
            } else {
                var agent = require(''+scheme);          
                agent.get(url, options, cb)
            }                
        }

        return route
    };

    

    /**
     * Get route by url
     * N.B.: this will only work with rules declared with `GET` method property
     *
     * @function getRouteByUrl
     *
     * @param {string} url e.g.: /bundle/some/url/path or http
     * @param {string} [bundle] targeted bundle
     * @param {string} [method] request method (GET|PUT|PUT|DELETE) - GET is set by default
     * @param {object} [request] 
     *
     * @return {object|boolean} route - when route is found; `false` when not found
     * */
    
    self.getRouteByUrl = function (url, bundle, method, request) {
        
        if (
            arguments.length == 2 && typeof(arguments[1]) != 'undefined' && self.allowedMethods.indexOf(arguments[1].toLowerCase()) > -1 
        ) {
            method = arguments[1], bundle = undefined;
        }

        var matched         = false
            , hostname      = null
            , config        = null
            , env           = null
            , webroot       = null
            , prefix        = null
            , pathname      = null
            , params        = null            
            , routing       = null
            , isRoute       = null
            , foundRoute    = null
            , route         = null
            , routeObj      = null
        ;

        if (isGFFCtx) {
            config          = window.gina.config;
            bundle          = (typeof (bundle) != 'undefined') ? bundle : config.bundle;
            env             = config.env;
            routing         = config.getRouting(bundle);
            isXMLRequest    = ( typeof(isXMLRequest) != 'undefined' ) ? isXMLRequest : false; // TODO - retrieve the right value

            hostname        = config.hostname;
            webroot         = config.webroot;
            prefix          = hostname + webroot;

            request = {
                routing: {
                    path: unescape(pathname)
                },
                method: method,
                params: {},
                url: url
            };
        } else {

            var gnaCtx      = getContext('gina');
            
            config          = gnaCtx.config;
            bundle          = (typeof (bundle) != 'undefined') ? bundle : config.bundle;
            env             = config.env;
            routing         = config.getRouting(bundle);
            
            

            hostname        = config.envConf[bundle][env].hostname;
            webroot         = config.envConf[bundle][env].server.webroot;
            prefix          = hostname + webroot;
            
            if ( !request ) {
                request = {
                    isXMLRequest: false,
                    method : ( typeof(method) != 'undefined' ) ? method.toLowerCase() : 'get'
                }
            }
            isXMLRequest    = request.isXMLRequest || false;
        }

        pathname    = url.replace( new RegExp('^('+ hostname +'|'+hostname.replace(/\:\d+/, '') +')' ), '');
        method      = ( typeof(method) != 'undefined' ) ? method.toLowerCase() : 'get';

        //  getting params
        params = {};
        
        

        var paramsList = null;
        var re = new RegExp(method, 'i');
        var localMethod = null;
        // N.B.: this part of the code must remain identical to the one used in `server.js`
        out:
            for (var name in routing) {
                if (typeof (routing[name]['param']) == 'undefined')
                    break;

                // bundle filter
                if (routing[name].bundle != bundle) continue;

                // method filter
                localMethod = routing[name].method;             
                if ( /\,/.test( localMethod ) && re.test(localMethod) ) {
                    localMethod = request.method
                } 
                if (typeof (routing[name].method) != 'undefined' && !re.test(localMethod)) continue;
                
                //Preparing params to relay to the core/router.                
                params = {
                    method              : localMethod,
                    requirements        : routing[name].requirements,
                    namespace           : routing[name].namespace || undefined,
                    url                 : unescape(pathname), /// avoid %20
                    rule                : routing[name].originalRule || name,
                    param               : routing[name].param,
                    //middleware: routing[name].middleware,
                    middleware          : JSON.parse(JSON.stringify(routing[name].middleware)),
                    bundle              : routing[name].bundle,
                    isXMLRequest        : isXMLRequest
                };

                // normal case
                //Parsing for the right url.
                try {
                    isRoute = self.compareUrls(params, routing[name].url, request);

                    if (isRoute.past) {

                        route = JSON.parse(JSON.stringify(routing[name]));
                        route.name = name;

                        matched = true;
                        isRoute = {};

                        break;
                    }

                } catch (err) {
                    throw new Error('Route [ ' + name + ' ] needs your attention.\n' + err.stack);
                }
            } //EO for break out

        if (!matched) {
            if (isGFFCtx) {
                console.warn('[ RoutingHelper::getRouteByUrl(rule[, bundle, method]) ] : route not found for url: `' + url + '` !');
                return false
            }

            console.warn( new Error('[ RoutingHelper::getRouteByUrl(rule[, bundle, method, request]) ] : route not found for url: `' + url + '` !').stack )
            
            return false;
        } else {
            return route
        }
    }

    return self
}

if ((typeof (module) !== 'undefined') && module.exports) {
    // Publish as node.js module
    module.exports = Routing()
} else if (typeof (define) === 'function' && define.amd) {
    // Publish as AMD module
    define('utils/routing',[],function() { return Routing() })
};
/**
 * Gina Local Storage
 * N.B.: this is based on Web StorageAPI & Node LocalStorage
 * See.:
 *  - https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API
 *  - https://www.npmjs.com/package/node-localstorage
 * */
function StoragePlugin(options) {

    var merge       = merge || require('utils/merge');;
    var Collection  = Collection || require('utils/collection');
    var uuid        = uuid || require('vendor/uuid');


    var self = {
        'options' : {
            'bucket': 'default'
        }
    };

    var bucketInstance = {};
    var storage     = null;

    var entities    = {}, collections = {}; // entities & collections (data) objects
    var keywords    = ['not null']; // TODO - null, exists


    var proto = {
        'bucket'    : undefined,
        'drop'      : bucketDrop,
        'Collection': Collection
    };

    var entityProto = {
        'insert'    : collectionInsert,
        'find'      : collectionFind,
        'findOne'   : collectionFindOne,
        'update'    : null,
        'delete'    : collectionDelete,
        'drop'      : collectionDrop
    };

    var init = function(options) {

        // detect if cookies are enabled
        if ( !window.localStorage || window.localStorage && ! typeof(window.localStorage.setItem) == 'undefined' ) {
            throw new Error('Make sure your browser supports `window.localStorage` to use Gina Storage. See: `https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API#Browser_compatibility`');
        }

        if ( typeof(options) != 'object' && typeof(options) != 'undefined' ) {
            throw new Error('`options` must be an object')
        } else if ( typeof(options) == 'undefined' ) {
            var options = {}
        }

        self.options    = merge(options, self.options);
        storage         = window.localStorage;

        var bucketName  = self.options['bucket'];
        var bucket      = storage.getItem(bucketName);

        if (!bucket && bucketName != undefined) {
            //console.log('creating new bucket !');
            bucketCreate(bucketName);
        } else if (bucketName == undefined) {
            throw new Error('`bucket` name cannot be undefined')
        }

        bucketInstance['bucket'] = bucketName;
        bucketInstance = merge(bucketInstance, proto);
    }



    /**
     * Create bucket
     *
     * @param {string} bucketName
     * */
    var bucketCreate = function(bucketName) {
        storage.setItem(bucketName, JSON.stringify(collections));
    }


    /**
     * Drop bucket
     *
     * */
    function bucketDrop() {
        storage.removeItem(self.options['bucket']);
        bucketInstance = null;

        for (var prop in this) {
            delete this[prop]
        }

        return bucketInstance;
    }

    var collectionSave = function (enforceDeleted) {

        var enforceDeleted = enforceDeleted || false;

        try {
            //backing up collections
            var tmpCollections  = JSON.parse(JSON.stringify(collections));
            var index           = this['_index'];
            var collection      = this['_collection'];
            var bucket          = this['_bucket'];
            var filter          = this['_filter'];
            this['_updatedAt']  = new Date().format("isoDateTime");

            merge(tmpCollections[ collection ][ index ], this, true);

            // cleaning
            delete tmpCollections[ collection ][ index ]['_index'];
            delete tmpCollections[ collection ][ index ]['_collection'];
            delete tmpCollections[ collection ][ index ]['_bucket'];
            delete tmpCollections[ collection ][ index ]['save'];
            delete tmpCollections[ collection ][ index ]['_filter'];

            if (enforceDeleted && typeof(tmpCollections[ collection ][ index ]) == 'object' ) {

                var parseEnforcedCollection = function (arr, target) {
                    for (var i = 0, len = arr.length; i < len; ++i) {
                        if ( typeof (target[i]) == 'object' && typeof(arr[i]) != 'undefined' && !Array.isArray(arr[i]) ) {
                            parseEnforced(arr[i], target[i])
                        } else if ( !Array.isArray(arr[i]) ){
                            if (typeof(arr[i]) == 'undefined') {
                                delete target[i]
                            }
                        } else { // is collection type
                            parseEnforcedCollection(arr[i], target[i])
                        }
                    }

                    return target
                }

                var parseEnforced = function (obj, target) {
                    for (var prop in target) {
                        if ( typeof (target[prop]) == 'object' && typeof(obj[prop]) != 'undefined' && !Array.isArray(obj[prop]) ) {
                            parseEnforced(obj[prop], target[prop])
                        } else if ( !Array.isArray(obj[prop]) ){
                            if (typeof(obj[prop]) == 'undefined') {
                                delete target[ prop ]
                            }
                        } else { // is collection type
                            parseEnforcedCollection(obj[prop], target[prop])
                        }
                    }

                    return target
                };

                if ( Array.isArray(tmpCollections[ collection ][ index ]) ) {
                    tmpCollections[ collection ][ index ] = parseEnforcedCollection(this, tmpCollections[ collection ][ index ])
                } else if ( typeof(tmpCollections[ collection ][ index ] ) == 'object' ) {
                    tmpCollections[ collection ][ index ] = parseEnforced(this, tmpCollections[ collection ][ index ])
                } else {
                    if (typeof(this[prop]) == 'undefined') {
                        delete tmpCollections[ collection ][ index ]
                    }
                }
            }

            collections[ collection ][ index ] = tmpCollections[ collection ][ index ];

            // saving
            storage.setItem(bucket, JSON.stringify(collections));

            return collectionFindOne(filter)

        } catch (err) {
            throw err
        }
    }

    /**
     * Create or Get Collection by name
     *
     * @param {string} name - Collection name
     * */
    function Collection(name) {
        // retrieve collections state
        collections = JSON.parse(storage.getItem(this['bucket']));
        //console.log('collections ', (collections || null) );
        if ( typeof(collections[name]) == 'undefined' ) {
            collections[name] = [];
            storage.setItem(this['bucket'], JSON.stringify(collections));
            collections = JSON.parse(storage.getItem(this['bucket']));
        }

        entities[name]      = { '_collection': name, '_bucket': this['bucket'] };
        entities[name]      = merge(entities[name], entityProto);

        return entities[name]
    }

    /**
     * Drop collection
     *
     * @param {string} name
     * */
    function collectionDrop(name) {
        if ( typeof(collections[ this['_collection'] ]) == 'undefined' ) {
            throw new Error('Collection `'+name+'` not found')
        }

        delete entities[ this['_collection'] ]; // delete entity
        delete collections[ this['_collection'] ]; // delete data

        storage.setItem(this['_bucket'], JSON.stringify(collections));
    }


    /**
     * Insert into collection
     *
     * @param {object} content
     * */
    function collectionInsert(content) {

        // TODO - add uuid
        content['_id']         = uuid.v1();
        content['_createdAt']  = new Date().format("isoDateTime");
        content['_updatedAt']  = new Date().format("isoDateTime");

        collections[ this['_collection'] ][ collections[ this['_collection'] ].length ] = content;

        storage.setItem(this['_bucket'], JSON.stringify(collections));
    }

    /**
     * Find from collection
     *
     * // TODO - add options
     *
     * @param {object} filter
     * @param {object} [options] - e.g.: limit
     *
     * @return {array} result
     * */
    function collectionFind(filter, options) {
        if (!filter) {
            // TODO - limit of ten by
            return collections[ this['_collection'] ]
        }

        if ( typeof(filter) !== 'object' ) { // == findAll
            throw new Error('filter must be an object');
        } else {
            //console.log('search into ', this['_collection'], collections[ this['_collection'] ], collections);
            var content             = collections[ this['_collection'] ]
                , condition         = filter.count()
                , i                 = 0
                , found             = []
                , localeLowerCase   = '';

            for (var o in content) {
                for (var f in filter) {
                    localeLowerCase = ( typeof(filter[f]) != 'boolean' ) ? filter[f].toLocaleLowerCase() : filter[f];
                    if ( filter[f] && keywords.indexOf(localeLowerCase) > -1 && localeLowerCase == 'not null' && typeof(content[o][f]) != 'undefined' && typeof(content[o][f]) !== 'object' && content[o][f] != 'null' && content[o][f] != 'undefined' ) {
                        if (found.indexOf(content[o][f]) < 0 ) {
                            found[i] = content[o][f];
                            ++i
                        }

                    } else if ( typeof(content[o][f]) != 'undefined' && typeof(content[o][f]) !== 'object' && content[o][f] === filter[f] ) {
                        found[i] = content[o];
                        ++i
                    }
                }
            }
        }

        return found
    }

    //function collectionLimit(limit) {}

    /**
     * Find a single result from collection
     *
     * e.g:
     *  // getting a record
     *  > var objectRecord = <bucket>.Collection('myBucket').findOne({_name: "someName"});
     *
     *  // updating record by adding or updating an existing property
     *  > objectRecord.myProperty = 'some value';
     *  > objectRecord.save();
     *
     *  // deleting record
     *  > objectRecord.myProperty.delete()
     *
     * @param {object} filter
     *
     * @returns {object|array|string} result
     *
     * */
    function collectionFindOne(filter) {

        if ( typeof(filter) !== 'object' ) {
            throw new Error('filter must be an object');
        } else {
            var content             = collections[ this['_collection'] ]
                , condition         = filter.count()
                , i                 = 0
                , result            = null
                , localeLowerCase   = '';


            //console.log('condition ', condition, '\nfitler', filter, '\ncontent', content);
            if (condition == 0) return null;

            for (var o in content) {
                for (var f in filter) {
                    localeLowerCase = ( typeof(filter[f]) != 'boolean' ) ? filter[f].toLocaleLowerCase() : filter[f];
                    if ( filter[f] && keywords.indexOf(localeLowerCase) > -1 && localeLowerCase == 'not null' && typeof(content[o][f]) != 'undefined' && typeof(content[o][f]) !== 'object' && content[o][f] === filter[f] && content[o][f] != 'null' && content[o][f] != 'undefined' ) {
                        if (result.indexOf(content[o][f]) < 0 ) {
                            ++i;
                            if (i === condition) {
                                result                   = content[o];
                                result['_index']         = o;
                                result['_collection']    = this['_collection'];
                                result['_bucket']        = this['_bucket'];
                            }

                        }

                    } else if ( typeof(content[o][f]) != 'undefined' && typeof(content[o][f]) !== 'object' && content[o][f] === filter[f] ) {
                        ++i;
                        if (i === condition) {
                            result                   = content[o];
                            result['_index']         = o;
                            result['_collection']    = this['_collection'];
                            result['_bucket']        = this['_bucket'];
                            result['_filter']        = filter;
                        }
                    }
                }
            }
        }

        if (result) {
            /**
             * save
             *  e.g.:
             *      // updating property
             *      <obj>.property = 'value';
             *      <obj>.save();
             *
             *      // deleting property
             *      delete <obj>.property;
             *      <obj>.save(true);
             *
             * @param {boolean} enforceDeleted
             * */
            result['save'] = collectionSave
        }


        return result
    }

    /**
     * Delete from collection
     *
     * @param {object} filter
     *
     * @return {array} result
     * */
    function collectionDelete(filter) {

        if ( typeof(filter) !== 'object' ) {
            throw new Error('filter must be an object');
        } else {
            var content     = JSON.parse(JSON.stringify( collections[ this['_collection'] ] ))
                //, condition = filter.count()
                , i         = 0
                , found     = [];

            for (var o in content) {
                for (var f in filter) {
                    if ( filter[f] && keywords.indexOf(filter[f].toLocaleLowerCase()) > -1 && filter[f].toLowerCase() == 'not null' && typeof(content[o][f]) != 'undefined' && typeof(content[o][f]) !== 'object' && content[o][f] != 'null' && content[o][f] != 'undefined' ) {
                        if (found.indexOf(content[o][f]) < 0 ) {
                            found[i] = content[o][f];
                            delete collections[ this['_collection'] ][o][f];
                            ++i
                        }

                    } else if ( typeof(content[o][f]) != 'undefined' && typeof(content[o][f]) !== 'object' && content[o][f] === filter[f] ) {
                        found[i] = content[o];
                        collections[ this['_collection'] ].splice(o, 1);
                        ++i
                    }
                }
            }
        }

        if (found.length > 0 ) {
            storage.setItem(this['_bucket'], JSON.stringify(collections));
            return true
        }

        return false
    }

    init(options);


    return bucketInstance
};

if ( ( typeof(module) !== 'undefined' ) && module.exports ) {
    // Publish as node.js module
    var merge       = require('utils/merge');//require('../../../../../lib/merge');
    var Collection  = require('utils/collection');//require('../../../../../lib/collection');
    var uuid        = require('uuid');

    module.exports = StoragePlugin

} else if ( typeof(define) === 'function' && define.amd) {
    // Publish as AMD module
    define('gina/storage',[],function() { return StoragePlugin })
};
/**
 * Operations on selectors
 * */

function insertAfter(referenceNode, newNode) {
    //console.log('inserting after ',referenceNode, newNode, referenceNode.nextSibling);
    referenceNode.parentNode.insertBefore(newNode, referenceNode.nextSibling)

}

function getElementsByAttribute(attribute) {
    var matching = [], m = 0;
    var els = document.getElementsByTagName('*');

    for (var i = 0, n = els.length; i < n; ++i) {
        if (els[i].getAttribute(attribute) !== null) {
            // Element exists with attribute. Add to array.
            matching[m] = els[i];
            ++m
        }
    }

    return matching
};
define("utils/dom", function(){});

/**
 * FormValidatorUtil
 *
 * Dependencies:
 *  - utils/merge
 *  - utils/helpers
 *  - utils/helpers/dateFormat
 *
 * @param {object} data
 * @param {object} [ $fields ] - isGFFCtx only
 * */
function FormValidatorUtil(data, $fields) {

    var isGFFCtx        = ( ( typeof(module) !== 'undefined' ) && module.exports ) ? false : true;

    if (isGFFCtx && !$fields )
        throw new Error('No `Validator` instance found.\nTry:\nvar FormValidator = require("gina/validator"):\nvar formValidator = new FormValidator(...);')

    var merge           = (isGFFCtx) ? require('utils/merge') : require('../../../../../lib/merge');
    var helpers         = (isGFFCtx) ? {} : require('../../../../../helpers');
    var dateFormat      = (isGFFCtx) ? require('helpers/dateFormat') : helpers.dateFormat;

    var local = {
        'errors': {},
        'keys': {
            '%l': 'label', // %l => label: needs `data-gina-form-field-label` attribute (frontend only)
            '%n': 'name', // %n => field name
            '%s': 'size' // %s => length
        },
        'errorLabels': {},
        'data': {}, // output to send
        'excluded': []
    };

    local.errorLabels = {
        'is': 'Condition not satisfied',
        'isEmail': 'A valid email is required',
        'isRequired': 'Cannot be left empty',
        'isBoolean': 'Must be a valid boolean',
        'isNumber': 'Must be a number: allowed values are integers or floats',
        'isNumberLength': 'Must contain %s characters',
        'isNumberMinLength': 'Should be at least %s characters',
        'isNumberMaxLength': 'Should not be more than %s characters',
        'isInteger': 'Must be an integer',
        'isIntegerLength': 'Must have %s characters',
        'isIntegerMinLength': 'Should be at least %s characters',
        'isIntegerMaxLength': 'Should not be more than %s characters',
        'toInteger': 'Could not be converted to integer',
        'isFloat': 'Must be a proper float',
        'isFloatException': 'Float exception found: %n',
        'toFloat': 'Could not be converted to float',
        'toFloatNAN': 'Value must be a valid number',
        'isDate': 'Must be a valid Date',
        'isString': 'Must be a string',
        'isStringLength': 'Must have %s characters',
        'isStringMinLength': 'Should be at least %s characters',
        'isStringMaxLength': 'Should not be more than %s characters',
        'isJsonWebToken': 'Must be a valid JSON Web Token'
    };

    if (!data) {
        throw new Error('missing data param')
    } else {
        // cloning
        var self  = JSON.parse( JSON.stringify(data) );
        local.data = JSON.parse( JSON.stringify(data) )
    }


    var val = null, label = null;
    for (var el in self) {

        if ( typeof(self[el]) == 'object' ) {
            try {
                val = JSON.parse( JSON.stringify( self[el] ))
            } catch (err) {
                val = self[el]
            }
        } else {
            val = self[el]
        }

        label = '';
        if ( isGFFCtx && typeof($fields) != 'undefined' ) { // frontend only
            label = $fields[el].getAttribute('data-gina-form-field-label') || '';
        }

        // keys are stringyfied because of the compiler !!!
        self[el] = {
            'target': (isGFFCtx) ? $fields[el] : null,
            'name': el,
            'value': val,
            'valid': false,
            // is name by default, but you should use setLabe(name) to change it if you need to
            'label': label,
            // check as field to exclude while sending datas to the model
            'exclude': false
        };

        /**
         *
         * is(condition)       -> validate if value matches `condition`
         *
         *  When entered in a JSON rule, you must double the backslashes
         *
         *  e.g.:
         *       "/\\D+/"       -> like [^0-9]
         *       "!/^\\\\s+/"   -> not starting by white space allow
         *       "/^[0-9]+$/"   -> only numbers
         *       "$field === $fieldOther"   -> will be evaluated
         *
         * @param {object|string} condition - RegExp object, or condition to eval, or eval result
         * @param {string} [errorMessage] - error message
         * @param {string} [errorStack] - error stack
         *
         * */
        self[el]['is'] = function(condition, errorMessage, errorStack) {
            var isValid   = false;
            var errors  = {};
            
            if ( !errors['isRequired'] && this.value == '' ) {
                isValid = true;
            }
            
            if (!isValid) {

                if ( /\$[-_\[\]a-z 0-9]+|^!\//i.test(condition) ) {

                    var variables = condition.match(/\${0}[-_\[\]a-z0-9]+/ig); // without space(s)
                    var compiledCondition = condition;
                    var re = null
                    for (var i = 0, len = variables.length; i < len; ++i) {
                        if ( typeof(self[ variables[i] ]) != 'undefined' && variables[i]) {
                            re = new RegExp("\\$"+ variables[i] +"(?!\\S+)", "g");
                            if ( self[ variables[i] ].value == "" ) {
                                compiledCondition = compiledCondition.replace(re, '""');
                            } else if ( typeof(self[ variables[i] ].value) == 'string' ) {
                                compiledCondition = compiledCondition.replace(re, '"'+ self[ variables[i] ].value +'"');
                            } else {
                                compiledCondition = compiledCondition.replace(re, self[ variables[i] ].value);
                            }
                        }
                    }

                    try {
                        // security checks
                        compiledCondition = compiledCondition.replace(/(\(|\)|return)/g, '');
                        if ( /^\//.test(compiledCondition) ) {
                            isValid = eval(compiledCondition + '.test("' + this.value + '")')
                        } else {
                            isValid = eval(compiledCondition)
                        }
                        
                    } catch (err) {
                        throw new Error(err.stack||err.message)
                    }
                } else if ( condition instanceof RegExp ) {

                    isValid = condition.test(this.value) ? true : false;

                } else if( typeof(condition) == 'boolean') {

                    isValid = (condition) ? true : false;

                } else {
                    try {
                        // TODO - motif /gi to pass to the second argument
                        if ( /\/(.*)\//.test(condition) ) {
                            var re = condition.match(/\/(.*)\//).pop()
                                , flags = condition.replace('/' + re + '/', '')
                            ;

                            isValid = new RegExp(re, flags).test(this.value)
                        } else {
                            isValid = eval(condition);
                        }
                            
                        //valid = new RegExp(condition.replace(/\//g, '')).test(this.value)
                    } catch (err) {
                        throw new Error(err.stack||err.message)
                    }
                }
            }

            if (!isValid) {
                errors['is'] = replace(this.error || errorMessage || local.errorLabels['is'], this);
                if ( typeof(errorStack) != 'undefined' )
                    errors['stack'] = errorStack;
            }

            this.valid = isValid;
            if ( errors.count() > 0 )
                this['errors'] = errors;

            return self[this.name]
        }

        self[el]['isEmail'] = function() {


            this.value      = local['data'][this.name] = this.value.toLowerCase();

            var rgx         = /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
            var isValid     = rgx.test(this['value']) ? true : false;
            var errors      = self[this['name']]['errors'] || {};

            if ( !errors['isRequired'] && this.value == '' ) {
                isValid = true;
            }

            if (!isValid) {
                errors['isEmail'] = replace(this['error'] || local.errorLabels['isEmail'], this)
            }

            this.valid = isValid;

            if ( errors.count() > 0 )
                this['errors'] = errors;

            return self[this['name']]
        }

        self[el]['isJsonWebToken'] = function() {


            this.value      = local['data'][this.name] = this.value.toLowerCase();

            var rgx         = /^[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*$/;
            var isValid     = rgx.test(this['value']) ? true : false;
            var errors      = self[this['name']]['errors'] || {};

            if ( !errors['isRequired'] && this.value == '' ) {
                isValid = true;
            }

            if (!isValid) {
                errors['isJsonWebToken'] = replace(this['error'] || local.errorLabels['isJsonWebToken'], this)
            }

            this.valid = isValid;

            if ( errors.count() > 0 )
                this['errors'] = errors;

            return self[this['name']]
        }
        
        /**
         * Check if boolean and convert to `true/false` booloean if value is a string or a number
         * Will include `false` value if isRequired
         * */
        self[el]['isBoolean'] = function() {
            var val     = null
                , errors = self[this['name']]['errors'] || {}
            ;

            if ( errors['isRequired'] && this.value == false ) {
                isValid = true;
                delete errors['isRequired'];
                this['errors'] = errors;
            }

            switch(this.value) {
                case 'true':
                case true:
                case 1:
                    val = this.value = local.data[this.name] = true;
                    break;
                case 'false':
                case false:
                case 0:
                    val = this.value = local.data[this.name] = false;
                    break;
            }
            var valid = (val !== null) ? true : false;

            if (!valid) {
                errors['isBoolean'] = replace(this.error || local.errorLabels['isBoolean'], this)
            }

            this.valid = valid;
            if ( errors.count() > 0 )
                this['errors'] = errors;

            return self[this.name]
        }

        /**
         * Check if value is an a Number.
         *  - valid if a number is found
         *  - cast into a number if a string is found
         *  - if string is blank, no transformation will be done: valid if not required
         *
         *  @param {number} minLength
         *  @param {number} maxLength
         *
         *  @return {object} result
         * */
        self[el]['isNumber'] = function(minLength, maxLength) {
            var val             = this.value
                , len           = 0
                , isValid       = false
                , isMinLength   = true
                , isMaxLength   = true
                , errors        = {}
                ;
            
            // test if val is a number
            try {
                // if val is a string replaces comas by points
                if ( typeof(val) == 'string' && /,/g.test(val) ) {
                    val = this.value = parseFloat( val.replace(/,/g, '.').replace(/\s+/g, '') );
                } else if ( typeof(val) == 'string' && val != '') {
                    val = this.value = parseInt( val.replace(/\s+/g, '') );
                }

            } catch (err) {
                errors['isNumber'] = replace(this.error || local.errorLabels['isNumber'], this);
                this.valid = false;
                if ( errors.count() > 0 )
                    this['errors'] = errors;
            }

            if ( +val === +val ) {
                isValid = true;
                if ( !errors['isRequired'] && val != '' ) {
                    len = val.toString().length;
                    // if so also test max and min length if defined
                    if (minLength && typeof(minLength) == 'number' && len < minLength) {
                        isMinLength = false;
                        this['size'] = minLength;
                    }
                    if (maxLength && typeof(maxLength) == 'number' && len > maxLength) {
                        isMaxLength = false;
                        this['size'] = maxLength;
                    }
                }
            }

            // if val is invalid return error message
            if ( !isValid || !isMinLength || !isMaxLength ) {

                if ( !isValid )
                    errors['isNumber'] = replace(this.error || local.errorLabels['isNumber'], this);
                if ( !isMinLength || !isMaxLength ) {
                    if ( !isMinLength )
                        errors['isNumberLength'] = replace(this.error || local.errorLabels['isNumberMinLength'], this);
                    if ( !isMaxLength )
                        errors['isNumberLength'] = replace(this.error || local.errorLabels['isNumberMaxLength'], this);
                    if ( minLength === maxLength )
                        errors['isNumberLength'] = replace(this.error || local.errorLabels['isNumberLength'], this);
                }

                isValid = false;
            }

            this.valid = isValid;
            val = this.value = local.data[this.name] = ( val != '' ) ? Number(val) : val;
            if ( errors.count() > 0 )
                this['errors'] = errors;

            return self[this.name]
        }

        self[el]['toInteger'] = function() {
            var val = this.value, errors = {};

            if (!val) {
                return self[this.name]
            } else {
                try {
                    //val = this.value = local.data[this.name] = ~~(val.match(/[0-9]+/g).join(''));
                    val = this.value = local.data[this.name] = Math.round(val);
                } catch (err) {

                    errors['toInteger'] = replace(this.error || local.errorLabels['toInteger'], this);
                    this.valid = false;
                    if ( errors.count() > 0 )
                        this['errors'] = errors;
                }

            }

            return self[this.name]
        }

        self[el]['isInteger'] = function(minLength, maxLength) {
            var val             = this.value
                , isValid       = false
                , isMinLength   = true
                , isMaxLength   = true
                , errors        = {}
                ;

            // test if val is a number
            if ( +val === +val && val % 1 === 0 ) {
                isValid = true;
                if ( !errors['isRequired'] && val != '' ) {
                    // if so also test max and min length if defined
                    if (minLength && typeof(minLength) == 'number' && val.length < minLength) {
                        isMinLength = false;
                        this['size'] = minLength;
                    }
                    if (maxLength && typeof(maxLength) == 'number' && val.length > maxLength) {
                        isMaxLength = false;
                        this['size'] = maxLength;
                    }
                }
            }
            // if val is invalid return error message
            if ( !isValid || !isMinLength || !isMaxLength ) {

                if ( !isValid )
                    errors['isInteger'] = replace(this.error || local.errorLabels['isInteger'], this);

                if ( !isMinLength || !isMaxLength ) {

                    if ( !isMinLength ) {
                        errors['isIntegerLength'] = replace(this.error || local.errorLabels['isIntegerMinLength'], this);
                        isValid = false;
                    }

                    if ( !isMaxLength ) {
                        errors['isIntegerLength'] = replace(this.error || local.errorLabels['isIntegerMaxLength'], this);
                        isValid = false;
                    }

                    if ( minLength === maxLength ) {
                        errors['isIntegerLength'] = replace(this.error || local.errorLabels['isIntegerLength'], this);
                        isValid = false;
                    }
                }
            }

            this.valid = isValid;
            val = this.value = local.data[this.name] = Number(val);

            if ( errors.count() > 0 )
                this['errors'] = errors;

            return self[this.name]
        }


        self[el]['toFloat'] = function(decimals) {
            if ( typeof(this.value) == 'string' ) {
                this.value = this.value.replace(/\s+/g, '');
                if ( /\,/.test(this.value) && !/\./.test(this.value) ) {
                    this.value = this.value.replace(/\,/g,'.');
                } else {
                    this.value = this.value.replace(/\,/g,'');
                }
            }

            var val = this.value, errors = {}, isValid = true;

            if (decimals) {
                this['decimals'] = parseInt(decimals)
            } else if ( typeof(this['decimals']) == 'undefined' ) {
                this['decimals'] = 2
            }

            if (!val) {
                return self[this.name]
            } else {
                if ( this['isNumber']().valid ) {
                    try {

                        if ( !Number.isFinite(val) ) {
                            val = this.value = local.data[this.name] = new Number(parseFloat(val.match(/[0-9.,]+/g).join('').replace(/,/, '.')));// Number <> number
                        }

                        this.target.setAttribute('value', val);
                    } catch(err) {
                        isValid = false;
                        errors['toFloat'] = replace(this.error || local.errorLabels['toFloat'], this);
                        this.valid = false;
                        if ( errors.count() > 0 )
                            this['errors'] = errors;
                    }
                } else {
                    isValid = false;
                    errors['toFloat'] = replace(this.error || local.errorLabels['toFloatNAN'], this)
                }
            }

            if (this['decimals'] && val && !errors['toFloat']) {
                this.value = local.data[this.name] = parseFloat(this.value.toFixed(this['decimals']));
            }

            this.valid = isValid;
            if ( errors.count() > 0 )
                this['errors'] = errors;

            return self[this.name]
        }

        /**
         * Check if value is float. No transformation is done here.
         * Can be used in combo preceded by *.toFloat(2) to transform data if needed:
         *  1 => 1.0
         *  or
         *  3 500,5 => 3500.50
         *
         *
         * @param {number} [ decimals ]
         *
         * TODO - decimals transformation
         * */
        self[el]['isFloat'] = function(decimals) {

            if ( typeof(this.value) == 'string' ) {
                this.value = this.value.replace(/\s+/g, '');
            }

            var val         = this.value
                , isValid   = false
                , errors    = {};


            if ( typeof(val) == 'string' && /\./.test(val) && Number.isFinite( Number(val) ) ) {
                isValid = true
            }

            // if string replaces comas by points
            if (typeof(val) == 'string' && /,/g.test(val)) {
                val =  this.value = local.data[this.name] = Number(val.replace(/,/g, '.'))
            }

            // test if val is strictly a float
            if ( Number(val) === val && val % 1 !== 0 ) {
                this.value = local.data[this.name] = Number(val);
                isValid = true
            } else {
                isValid = false
            }

            if ( !errors['isRequired'] && this.value == '' ) {
                isValid = true
            }

            if (!isValid) {
                errors['isFloat'] = replace(this.error || local.errorLabels['isFloat'], this)
            }

            this.valid = isValid;
            if ( errors.count() > 0 )
                this['errors'] = errors;

            return self[this.name]
        }

        self[el]['isRequired'] = function(isApplicable) {

            if ( typeof(isApplicable) == 'boolean' && !isApplicable ) {

                this.valid = true;

                return self[this.name]
            }

            // radio group case
            if ( isGFFCtx && this.target.tagName == 'INPUT' && typeof(this.target.type) != 'undefined' && this.target.type == 'radio' ) {
                var radios = document.getElementsByName(this.name);
                for (var i = 0, len = radios.length; i < len; ++i) {
                    if (radios[i].checked) {
                        if ( /true|false/.test(radios[i].value) ) {
                            this.value = local.data[this.name] = ( /true/.test(radios[i].value) ) ? true : false
                        } else {
                            this.value = local.data[this.name] = radios[i].value;
                        }

                        this.valid = true;
                        break;
                    }
                }
            }


            var isValid = ( typeof(this.value) != 'undefined' && this.value != null && this.value != '' && !/^\s+/.test(this.value) ) ? true : false;
            var errors  = {};


            if (!isValid) {
                errors['isRequired'] = replace(this.error || local.errorLabels['isRequired'], this)
            }

            this.valid = isValid;
            if (errors.count() > 0)
                this['errors'] = errors;

            return self[this.name]
        }
        /**
         *
         * isString()       -> validate if value is string
         * isString(10)     -> validate if value is at least 10 chars length
         * isString(0, 45)  -> no minimum length, but validate if value is maximum 45 chars length
         *
         * @param {number|undefined} [ minLength ]
         * @param {number} [ maxLength ]
         * */
        self[el]['isString'] = function(minLength, maxLength) {

            var val             = this.value
                , isValid       = false
                , isMinLength   = true
                , isMaxLength   = true
                , errors        = {}
                ;


            // test if val is a string
            if ( typeof(val) == 'string' ) {
                isValid = true;

                if ( !errors['isRequired'] && val != '' ) {
                    // if so also test max and min length if defined
                    if (minLength && typeof(minLength) == 'number' && val.length < minLength) {
                        isMinLength = false;
                        this['size'] = minLength;
                    }
                    if (maxLength && typeof(maxLength) == 'number' && val.length > maxLength) {
                        isMaxLength = false;
                        this['size'] = maxLength;
                    }
                }

            }

            // if val is invalid return error message
            if (!isValid || !isMinLength || !isMaxLength ) {

                if (!isValid && errors['isRequired'] && val == '') {
                    isValid = false;
                    errors['isString'] = replace(this['error'] || local.errorLabels['isString'], this);
                } else if (!isValid && !errors['isRequired']) {
                    isValid = true;
                }

                if ( !isMinLength || !isMaxLength) {
                    isValid = false;

                    if ( !isMinLength )
                        errors['isStringLength'] = replace(this['error'] || local.errorLabels['isStringMinLength'], this);
                    if ( !isMaxLength )
                        errors['isStringLength'] = replace(this['error'] || local.errorLabels['isStringMaxLength'], this);
                    if (minLength === maxLength)
                        errors['isStringLength'] = replace(this['error'] || local.errorLabels['isStringLength'], this);
                }

            }

            this.valid = isValid;
            if ( errors.count() > 0 )
                this['errors'] = errors;


            return self[this.name]
        }

        /**
         * Check if date
         *
         * @param {string} [mask] - by default "yyyy-mm-dd"
         *
         * @return {date} date - extended by gina::utils::dateFormat; an adaptation of Steven Levithan's code
         * */
        self[el]['isDate'] = function(mask) {
            var val         = this.value
                , isValid   = false
                , errors    = {}
                ;
            if (!val) return self[this.name];

            var m = mask.match(/[^\/\- ]+/g);
            val = val.match(/[^\/\- ]+/g);
            var dic = {}, d, len;
            for (d=0, len=m.length; d<len; ++d) {
                dic[m[d]] = val[d]
            }
            var newMask = 'yyyy-mm-dd';
            for (var v in dic) {
                newMask = newMask.replace(new RegExp(v, "g"), dic[v])
            }

            var date = this.value = local.data[this.name] = new Date(newMask);

            if ( date instanceof Date ) {
                isValid = true;
            } else {
                if ( !errors['isRequired'] && this.value == '' ) {
                    isValid = true
                } else {
                    errors['isDate'] = replace(this.error || local.errorLabels['isDate'], this);
                }

                this.valid = isValid;
                if ( errors.count() > 0 )
                    this['errors'] = errors;

                return self[this.name]
            }

            this.valid = isValid;

            return date
        }

        /**
         * Formating date using DateFormatHelper
         * Check out documentation in the helper source: `utils/helpers/dateFormat.js`
         * e.g.:
         *      d.start
         *        .isDate('dd/mm/yyyy')
         *        .format('isoDateTime');
         *
         *
         * */
        self[el]['format'] = function(mask, utc) {
            var val = this.value;
            if (!val) return self[this.name];

            return val.format(mask, utc)
        };

        /**
         * Set flash
         *
         * @param {str} flash
         * */
        self[el]['setFlash'] = function(regex, flash) {
            if ( typeof(flash) != 'undefined' && flash != '') {
                this.error = flash
            }
            return self[this.name]
        }

        /**
         * Set label
         *
         * @param {str} label
         * */
        self[el]['setLabel'] = function(label) {
            if ( typeof(label) != 'undefined' && label != '') {
                this.label = label
            }
            return self[this.name]
        }
        
        /**
         * Trim when string starts or ends with white space(s)
         *
         * @param {str} trimmed off string
         * */
        self[el]['trim'] = function(isApplicable) {
            if ( typeof(isApplicable) == 'boolean' && isApplicable ) {
                this.value = this.value.replace(/^\s+|\s+$/, '');
                local.data[this.name] = this.value;

                return self[this.name]
            }
        }

        /**
         * Exclude when converting back to datas
         *
         * @return {object} data
         * */
        self[el]['exclude'] = function(isApplicable) {

            if ( typeof(isApplicable) == 'boolean' && !isApplicable ) {

                local.data[this.name] = this.value;

                return self[this.name]
            }

            // list field to be purged
            local.excluded.push(this.name);
        }

    } // EO for (var el in self)

    /**
     * Check if errors found during validation
     *
     * @return {boolean}
     * */
    self['isValid'] = function() {

        var i = self['getErrors']().count();
        var valid = true;

        if (i > 0) {
            valid = false;
        }

        return valid
    }

    self['getErrors'] = function() {
        var errors = {};

        for (var field in self) {
            if ( typeof(self[field]) != 'function' && typeof(self[field]['errors']) != 'undefined' ) {
                if ( self[field]['errors'].count() > 0)
                    errors[field] = self[field]['errors'];
            }
        }

        return errors
    }

    self['toData'] = function() {

        // cleaning data
        if (local.excluded.length > 0) {
            for (var i = 0, len = local.excluded.length; i < len; ++i) {
                if ( typeof(local.data[ local.excluded[i] ]) != 'undefined' ) {
                    delete local.data[ local.excluded[i] ]
                }
            }
        }

        return local.data
    }

    var replace = function(target, fieldObj) {
        var keys = target.match(/%[a-z]+/gi);
        if (keys) {
            for (var k = 0, len = keys.length; k < len; ++k) {
                target = target.replace(new RegExp(keys[k], 'g'), fieldObj[local.keys[keys[k]]])
            }
        }

        return target
    }

    self['setErrorLabels'] = function (errorLabels) {
        if ( typeof(errorLabels) != 'undefined') {
            local.errorLabels = merge(errorLabels, local.errorLabels)
        }
    }

    return self
};

if ( ( typeof(module) !== 'undefined' ) && module.exports ) {
    // Publish as node.js module
    module.exports  = FormValidatorUtil
} else if ( typeof(define) === 'function' && define.amd) {
    // Publish as AMD module
    define('utils/form-validator',[],function() { return FormValidatorUtil })
};

/**
 * ValidatorPlugin
 *
 * Dependencies:
 *  - utils/form-validator
 *  - utils/merge
 *  - utils/events
 *  - vendor/uuid
 *
 * @param {object} rule
 * @param {object} [ data ] // from request
 * @param {string} [ formId ]
 * */
function ValidatorPlugin(rules, data, formId) {

    this.plugin = 'validator';

    /**
     * validator event handler - isGFFCtx only
     * */
    var events      = ['ready', 'error', 'progress', 'submit', 'success', 'change', "destroy"];

    /** imports */
    var isGFFCtx        = ( ( typeof(module) !== 'undefined' ) && module.exports ) ? false : true;
    if (isGFFCtx) {
        require('utils/events');
        registerEvents(this.plugin, events);

        require('utils/dom');

    } else {
        var cacheless   = (process.env.IS_CACHELESS == 'false') ? false : true;
        if (cacheless) {
            delete require.cache[require.resolve('./form-validator')]
        }
    }

    var uuid            = (isGFFCtx) ? require('vendor/uuid') : require('uuid');
    var merge           = (isGFFCtx) ? require('utils/merge') : require('../../../../../lib/merge');
    var FormValidator   = (isGFFCtx) ? require('utils/form-validator') : require('./form-validator');

    /** definitions */
    var instance    = { // isGFFCtx only
        'id'                : 'validator-' + uuid.v4(),

        'plugin'            : this.plugin,
        'on'                : (isGFFCtx) ? on : null,
        'eventData'         : {},
        'target'            : (isGFFCtx) ? document : null, // by default

        'initialized'       : false,
        'isReady'           : false,
        'rules'             : {},
        '$forms'            : {},
        'getFormById'       : null,
        'validateFormById'  : null,
        'setOptions'        : null,
        'resetErrorsDisplay': null,
        'resetFields'       : null
    };

    // validator proto
    var $validator      = { // isGFFCtx only
        'id'                    : null, // form id

        'plugin'                : this.plugin,
        'on'                    : (isGFFCtx) ? on : null,
        'eventData'             : {},
        'target'                : (isGFFCtx) ? document : null, // by default

        'binded'                : false,
        'withUserBindings'      : false,
        'rules'                 : {},
        'setOptions'            : null,
        'send'                  : null,
        'submit'                : null,
        'destroy'               : null,
        'resetErrorsDisplay'    : null,
        'resetFields'           : null
    };


    /**
     * XML Request - isGFFCtx only
     * */
    var xhr         = null;
    var xhrOptions  = {
        'url'           : '',
        'method'        : 'GET',
        'isSynchrone'   : false,
        'withCredentials': false,
        'headers'       : {
            // to upload, use `multipart/form-data` for `enctype`
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            // cross domain is enabled by default, but you need to setup `Access-Control-Allow-Origin`
            'X-Requested-With': 'XMLHttpRequest' // in case of cross domain origin

        }
    };

    /**
     * backend definitions
     * */
    var setCustomRules = function (customRules) {
        // parsing rules
        if ( typeof(customRule) != 'undefined' ) {
            try {
                parseRules(customRule, '');
                checkForRulesImports(customRule);
            } catch (err) {
                throw err
            }
        }
    }

    var backendProto = {
        'setCustomRules': setCustomRules
    };


    /**
     * Backend init
     *
     * @param {object} rules
     * @param {object} [customRule]
     * */
    var backendInit = function (rules, data, formId) {

        var $form = ( typeof(formId) != 'undefined' ) ? { 'id': formId } : null;
        var fields = {};
        
        for (var field in data) {
            fields[field] = data[field]
        }


        // parsing rules
        if ( typeof(rules) != 'undefined' && rules.count() > 0 ) {
            
            try {
                parseRules(rules, '');
                checkForRulesImports(rules);
            } catch (err) {
                throw err
            }

            backendProto.rules = instance.rules;

            return validate($form, fields, null, instance.rules)

        } else {
            // without rules - by hand
            return new FormValidator(fields)
        }
    }


    /**
     * GFF definitions
     * */

    var setOptions = function (options) {
        var options = merge(options, xhrOptions);
        xhrOptions = options;
    }


    var getFormById = function(formId) {
        var $form = null, _id = formId;

        if ( !instance['$forms'] )
            throw new Error('`$forms` collection not found');

        if ( typeof(_id) == 'undefined') {
            throw new Error('[ FormValidator::getFormById(formId) ] `formId` is missing')
        }

        _id = _id.replace(/\#/, '');

        // in case form is created on the fly and is not yet registered
        if (document.getElementById(_id) != null && typeof (instance['$forms'][_id]) == 'undefined') {
            //instance['$forms'][_id] = document.getElementById(_id);
            
            initForm( document.getElementById(_id) );
        }

        if ( typeof(instance['$forms'][_id]) != 'undefined' ) {
            instance['$forms'][_id].withUserBindings = true;

            if ( typeof(this.$forms[_id]) == 'undefined') {
                this.$forms[_id] = instance['$forms'][_id];
            }
            $form = this.$forms[_id];
        }

        return $form
    }


    /**
     * validateFormById
     *
     * @param {string} formId
     * @param {object} [customRule]
     *
     * @return {object} $form
     * */
    var validateFormById = function(formId, customRule) {
        var $form = null, _id = formId;


        if ( !instance['$forms'] ) {
            throw new Error('`$forms` collection not found')
        }


        if ( typeof(_id) == 'undefined') {
            if ( typeof(this.id) != 'undefined' && this.id != '' && this.id != null ) {
                _id = this.id
            } else {
                throw new Error('[ FormValidator::validateFormById(formId, customRule) ] `formId` is missing')
            }
        }

        if ( typeof(_id) == 'string') {
            _id = _id.replace(/\#/, '')
        } else if ( typeof(_id) == 'object' && !Array.isArray(_id) ) { // weird exception

            var $target = _id.form;
            _id = $target.getAttribute('id') || 'form.'+uuid.v4();

            $target.setAttribute('id', _id);// just in case

        } else {
            throw new Error('[ FormValidator::validateFormById(formId[, customRule]) ] `formId` should be a `string`');
        }

        if ( typeof(instance['$forms'][_id]) != 'undefined' ) {
            $form   = this.$forms[_id] = instance['$forms'][_id];
        } else { // binding a form out of context (outside of the main instance)
            var $target             = document.getElementById(_id);
            $validator.id           = _id;
            $validator.target       = $target;

            $form = this.$forms[_id] = instance.$forms[_id] = merge({}, $validator);

            var rule    = null;
            if ( typeof(customRule) == 'undefined') {
                rule = _id.replace(/\-/g, '.');

                if ( typeof(instance.rules[rule]) != 'undefined' ) {
                    $form['rule'] = customRule = instance.rules[rule];
                } else if ( typeof($form.target) != 'undefined' && $form.target !== null && $form.target.getAttribute('data-gina-form-rule') ) {
                    rule = $form.target.getAttribute('data-gina-form-rule').replace(/\-/g, '.');

                    if ( typeof(instance.rules[rule]) != 'undefined' ) {
                        $form['rule'] = instance.rules[rule]
                    } else {
                        throw new Error('[ FormValidator::validateFormById(formId) ] using `data-gina-form-rule` on form `'+$form.target+'`: no matching rule found')
                    }
                } // no else to allow form without any rule
            } else {
                rule = customRule.replace(/\-/g, '.');

                if ( typeof(instance.rules[rule]) != 'undefined' ) {
                    $form['rule'] = instance.rules[rule]
                } else {
                    throw new Error('[ FormValidator::validateFormById(formId, customRule) ] `'+customRule+'` is not a valid rule')
                }
            }

            if ($target && !$form.binded)
                bindForm($target, rule);
        }

        if (!$form) throw new Error('[ FormValidator::validateFormById(formId, customRule) ] `'+_id+'` not found');

        return $form || null;

    }

    /**
     * handleErrorsDisplay
     * Attention: if you are going to handle errors display by hand, set data to `null` to prevent Toolbar refresh with empty data
     * @param {object} $form 
     * @param {object} errors 
     * @param {object|null} data 
     */
    var handleErrorsDisplay = function($form, errors, data) {

        if ( GINA_ENV_IS_DEV )
            var formsErrors = null;

        var name    = null, errAttr = null;
        var $err    = null, $msg = null;
        var $el     = null, $parent = null, $target = null;
        var id      = $form.getAttribute('id');
        var data    = ( typeof(data) != 'undefined' ) ? data : {};

        for (var i = 0, len = $form.length; i<len; ++i) {
            $el     = $form[i];
            if ( /form\-item\-wrapper$/.test($el.parentNode.className) ) {
                $parent = $el.parentNode.parentNode;
                $target = $el.parentNode;
            } else {
                $parent = $el.parentNode;
                $target = $el;
            }

            name    = $el.getAttribute('name');
            errAttr = $el.getAttribute('data-gina-form-errors');

            if (!name) continue;

            if ( typeof(errors[name]) != 'undefined' && !/form\-item\-error/.test($parent.className) ) {

                $parent.className += ($parent.className == '' ) ? 'form-item-error' : ' form-item-error';

                $err = document.createElement('div');
                $err.setAttribute('class', 'form-item-error-message');

                // injecting error messages
                for (var e in errors[name]) {

                    if (e != 'stack') { // ignore stack for display
                        $msg = document.createElement('p');
                        $msg.appendChild( document.createTextNode(errors[name][e]) );
                        $err.appendChild($msg);
                    }

                    if ( GINA_ENV_IS_DEV ) {
                        if (!formsErrors) formsErrors = {};
                        if ( !formsErrors[ name ] )
                            formsErrors[ name ] = {};

                        formsErrors[ name ][e] = errors[name][e]
                    }
                }

                if ($target.type != 'hidden')
                    insertAfter($target, $err);

            } else if ( typeof(errors[name]) == 'undefined' && /form\-item\-error/.test($parent.className) ) {
                // reset when not in error
                // remove child elements
                var $children = $parent.getElementsByTagName('div');
                for (var c = 0, cLen = $children.length; c<cLen; ++c) {
                    if ( /form\-item\-error\-message/.test($children[c].className) ) {
                        //$parent.removeChild($children[c]);
                        $children[c].parentElement.removeChild($children[c]);
                        break
                    }
                }

                $parent.className = $parent.className.replace(/(\s+form\-item\-error|form\-item\-error)/, '');

            } else if ( typeof(errors[name]) != 'undefined' && errAttr) {
                // refreshing already displayed error on msg update
                var $divs = $parent.getElementsByTagName('div');
                for (var d = 0, dLen = $divs.length; d<dLen; ++d) {
                    if ($divs[d].className == 'form-item-error-message') {

                        $divs[d].parentElement.removeChild($divs[d]);
                        $err = document.createElement('div');
                        $err.setAttribute('class', 'form-item-error-message');

                        // injecting error messages
                        for (var e in errors[name]) {
                            $msg = document.createElement('p');
                            $msg.appendChild( document.createTextNode(errors[name][e]) );
                            $err.appendChild($msg);

                            if ( GINA_ENV_IS_DEV ) {
                                if (!formsErrors) formsErrors = {};
                                if ( !formsErrors[ name ] )
                                    formsErrors[ name ] = {};

                                formsErrors[ name ][e] = errors[name][e]
                            }
                        }

                        break;
                    }
                }

                if ($target.type != 'hidden')
                    insertAfter($target, $err);

            }
        }


        var objCallback = null;
        if ( formsErrors ) {

            triggerEvent(gina, $form, 'error.' + id, errors)

            if ( isGFFCtx && typeof(window.ginaToolbar) == 'object' ) {
                // update toolbar
                if (!gina.forms.errors)
                    gina.forms.errors = {};

                objCallback = {
                    id      : id,
                    errors  : formsErrors
                };

                window.ginaToolbar.update('forms', objCallback);
            }
        } else if ( isGFFCtx && typeof(window.ginaToolbar) == 'object') { // reset toolbar form errors
            if (!gina.forms.errors)
                gina.forms.errors = {};

            objCallback = {
                id: id,
                errors: {}
            };
            if (isGFFCtx)
                window.ginaToolbar.update('forms', objCallback);
        }

        if (gina && isGFFCtx && typeof(window.ginaToolbar) == "object" && data) {
            try {
                // update toolbar
                window.ginaToolbar.update('data-xhr', data);

            } catch (err) {
                throw err
            }
        }

    }


    /**
     * Reset errors display
     *
     * @param {object|string} [$form|formId]
     *
     * */
    var resetErrorsDisplay = function($form) {
        var $form = $form, _id = null;
        if ( typeof($form) == 'undefined' ) {
            if ( typeof(this.target) != 'undefined' ) {
                _id = this.target.getAttribute('id');
            } else {
                _id = this.getAttribute('id');
            }

            $form = instance.$forms[_id]
        } else if ( typeof($form) == 'string' ) {
            _id = $form;
            _id = _id.replace(/\#/, '');

            if ( typeof(instance.$forms[_id]) == 'undefined') {
                throw new Error('[ FormValidator::resetErrorsDisplay([formId]) ] `'+$form+'` not found')
            }

            $form = instance.$forms[_id]
        }
        //reseting error display
        handleErrorsDisplay($form['target'], []);

        return $form
    }

    /**
     * Reset fields
     *
     * @param {object|string} [$form|formId]
     *
     * */
    var resetFields = function($form) {
        var $form = $form, _id = null;
        if ( typeof($form) == 'undefined' ) {
            if ( typeof(this.target) != 'undefined' ) {
                _id = this.target.getAttribute('id');
            } else {
                _id = this.getAttribute('id');
            }

            $form = instance.$forms[_id]
        } else if ( typeof($form) == 'string' ) {
            _id = $form;
            _id = _id.replace(/\#/, '');

            if ( typeof(instance.$forms[_id]) == 'undefined') {
                throw new Error('[ FormValidator::resetErrorsDisplay([formId]) ] `'+$form+'` not found')
            }

            $form = instance.$forms[_id]
        }

        if ($form.fieldsSet) {

            var elId            = null
                , $element      = null
                , type          = null
                , defaultValue  = null;

            for (var f in $form.fieldsSet) {

                $element    = document.getElementById(f)
                type        = $element.tagName.toLowerCase();

                if (type == 'input') {
                    $element.value = $form.fieldsSet[f].value;
                } else if ( type == 'select' ) {
                    
                    defaultValue = $element.getAttribute('data-value') || null;
                    
                    if (defaultValue && typeof($element.options[ defaultValue ]) != 'undefined' ) {
                        $element.options[ defaultValue ].selected = true;
                    } else {
                        $element.options[ $form.fieldsSet[f].value ].selected = true;
                        $element.setAttribute('data-value',  $element.options[ $form.fieldsSet[f].value ].value);    
                    }
                }
            }
        }

        return $form
    }

    // TODO - refreshErrorsDisplay
    // var refreshErrorsDisplay = function ($form) {
    //
    // }

    var submit = function () {

        var $form = null, _id = null, $target = null;

        if ( typeof(this.getAttribute) != 'undefined' ) {
            _id = this.getAttribute('id');
            $target = this;
        } else if ( typeof(this.target) != 'undefined' && this.target != null && typeof(this.target.getAttribute) != 'undefined' ) {
            _id = this.target.getAttribute('id');
            $target = this.target
        }

        if ( typeof(instance.$forms[_id]) == 'undefined') {
            throw new Error('[ FormValidator::submit() ] not `$form` binded. Use `FormValidator::getFormById(id)` or `FormValidator::validateFormById(id)` first ')
        }

        triggerEvent(gina, $target, 'submit');

        return this;
    }


    /**
     * send
     * N.B.: no validation here; if you want to validate against rules, use `.submit()` before
     *
     *
     * @param {object} data
     * @param {object} [ options ] : { isSynchrone: true, withCredentials: true }
     * */
    var send = function(data, options) {

        var $target = this.target , id = $target.getAttribute('id');
        var $form   = instance.$forms[id] || this;
        var result  = null;
        var XHRData = null;
        var isAttachment = null; // handle download
        var hFormIsRequired = null;
        
        options = (typeof (options) != 'undefined') ? merge(options, xhrOptions) : xhrOptions;
        
        // forward callback to HTML data event attribute through `hform` status
        hFormIsRequired = ( $target.getAttribute('data-gina-form-event-on-submit-success') || $target.getAttribute('data-gina-form-event-on-submit-error') ) ? true : false;
        // success -> data-gina-form-event-on-submit-success
        // error -> data-gina-form-event-on-submit-error
        if (hFormIsRequired)
            listenToXhrEvents($form);

        var url         = $target.getAttribute('action') || options.url;
        var method      = $target.getAttribute('method') || options.method;
        method          = method.toUpperCase();
        options.method  = method;
        options.url     = url;

        // to upload, use `multipart/form-data` for `enctype`
        var enctype = $target.getAttribute('enctype') || options.headers['Content-Type'];
                

        if ( options.withCredentials ) {

            if ('withCredentials' in xhr) {
                // XHR for Chrome/Firefox/Opera/Safari.
                if (options.isSynchrone) {
                    xhr.open(options.method, options.url, options.isSynchrone)
                } else {
                    xhr.open(options.method, options.url)
                }
            } else if ( typeof XDomainRequest != 'undefined' ) {
                // XDomainRequest for IE.
                xhr = new XDomainRequest();
                xhr.open(options.method, options.url);
            } else {
                // CORS not supported.
                xhr = null;
                result = 'CORS not supported: the server is missing the header `"Access-Control-Allow-Credentials": true` ';
                triggerEvent(gina, $target, 'error.' + id, result);

                return
            }
            
            if ( typeof(options.responseType) != 'undefined' ) {
                xhr.responseType = options.responseType;
            } else {
                xhr.responseType = '';
            }

            xhr.withCredentials = true;
        } else {
            if (options.isSynchrone) {
                xhr.open(options.method, options.url, options.isSynchrone)
            } else {
                xhr.open(options.method, options.url)
            }
        }

        // setting up headers -    all but Content-Type ; it will be set right before .send() is called
        for (var hearder in options.headers) {
             //if ( hearder == 'Content-Type' && typeof (enctype) != 'undefined' && enctype != null && enctype != '') {
             //    options.headers[hearder] = enctype
             //}
            if (hearder == 'Content-Type' && typeof (enctype) != 'undefined' && enctype != null && enctype != '')
                continue;

            xhr.setRequestHeader(hearder, options.headers[hearder]);
        }
        
        if (xhr) {
            // catching ready state cb
            xhr.onreadystatechange = function (event) {
                
                if (xhr.readyState == 2) { // responseType interception
                    isAttachment    = ( /^attachment\;/.test( xhr.getResponseHeader("Content-Disposition") ) ) ? true : false; 
                    // force blob response type
                    if ( !xhr.responseType && isAttachment ) {
                        xhr.responseType = 'blob';
                    }
                }

                if (xhr.readyState == 4) {
                    var blob            = null;
                    var contentType     = xhr.getResponseHeader("Content-Type");     
                       
                    // 200, 201, 201' etc ...
                    if( /^2/.test(xhr.status) ) {

                        try {
                            
                            
                            // handling blob xhr download
                            if ( /blob/.test(xhr.responseType) || isAttachment ) {
                                if ( typeof(contentType) == 'undefined' || contentType == null) {
                                    contentType = 'application/octet-stream';
                                }
                                
                                blob = new Blob([this.response], { type: contentType });
                                
                                //Create a link element, hide it, direct it towards the blob, and then 'click' it programatically
                                var a = document.createElement('a');
                                a.style = "display: none";
                                document.body.appendChild(a);
                                //Create a DOMString representing the blob and point the link element towards it
                                var url = window.URL.createObjectURL(blob);
                                a.href = url;
                                var contentDisposition = xhr.getResponseHeader("Content-Disposition");
                                a.download = contentDisposition.match('\=(.*)')[0].substr(1);
                                //programatically click the link to trigger the download
                                a.click();
                                //release the reference to the file by revoking the Object URL
                                window.URL.revokeObjectURL(url);
                                
                                result = {
                                    status : xhr.status,
                                    statusText: xhr.statusText,
                                    responseType: blob.type,
                                    type : blob.type,
                                    size : blob.size 
                                }
                                
                            } else { // normal case
                                result = xhr.responseText;                                
                            }
                            

                            
                            if ( /\/json/.test( contentType ) ) {
                                result = JSON.parse(xhr.responseText);
                                
                                if ( typeof(result.status) == 'undefined' )
                                    result.status = xhr.status;
                            }
                            
                            if ( /\/html/.test( contentType ) ) {
                                
                                result = {
                                    contentType : contentType,
                                    content     : xhr.responseText
                                };
                                
                                if ( typeof(result.status) == 'undefined' )
                                    result.status = xhr.status;
                                    
                                // if hasPopinHandler & popinIsBinded
                                if ( typeof(gina.popin) != 'undefined' && gina.hasPopinHandler /** && gina.popinIsBinded*/ ) {
                                    
                                    // select popin by id
                                    var $popin = gina.popin.getActivePopin();
                                    
                                    if ($popin) {
                                                     
                                        XHRData = {};
                                        // update toolbar
                                            
                                        try {
                                            XHRData = new DOMParser().parseFromString(result.content, 'text/html').getElementById('gina-without-layout-xhr-data');
                                            XHRData = JSON.parse(decodeURIComponent(XHRData.value));
                                            
                                            XHRView = new DOMParser().parseFromString(result.content, 'text/html').getElementById('gina-without-layout-xhr-view');      
                                            XHRView = JSON.parse(decodeURIComponent(XHRView.value));
                                            
                                            // update data tab                                                
                                            if ( gina && typeof(window.ginaToolbar) && typeof(XHRData) != 'undefined' ) {
                                                window.ginaToolbar.update("data-xhr", XHRData);
                                            }
                                            
                                            // update view tab
                                            
                                            if ( gina && typeof(window.ginaToolbar) && typeof(XHRView) != 'undefined' ) {
                                                window.ginaToolbar.update("view-xhr", XHRView);
                                            }   

                                        } catch (err) {
                                            throw err
                                        }
                                        
                                        
                                        $popin.loadContent(result.content);
                                                                                
                                        result = XHRData;
                                        triggerEvent(gina, $target, 'success.' + id, result);
                                        
                                        return;
                                    }
                                    
                                    
                                }
                            }

                            $form.eventData.success = result;

                            XHRData = result;
                            // update toolbar
                            if ( gina && typeof(window.ginaToolbar) == "object" && XHRData ) {
                                try {
                                    // don't refresh for html datas
                                    if ( typeof(XHRData) != 'undefined' && /\/html/.test(contentType) ) {
                                        window.ginaToolbar.update("data-xhr", XHRData);
                                    }

                                } catch (err) {
                                    throw err
                                }
                            }

                            triggerEvent(gina, $target, 'success.' + id, result);
                            if (hFormIsRequired)
                                triggerEvent(gina, $target, 'success.' + id + '.hform', result);
                            
                        } catch (err) {

                            result = {
                                status:  422,
                                error : err.message,
                                stack : err.stack

                            };

                            $form.eventData.error = result;
                          

                            XHRData = result;                            
                            // update toolbar
                            if ( gina && typeof(window.ginaToolbar) == "object" && XHRData ) {
                                try {

                                    if ( typeof(XHRData) != 'undefined' ) {
                                        window.ginaToolbar.update("data-xhr", XHRData);
                                    }

                                } catch (err) {
                                    throw err
                                }
                            }

                            triggerEvent(gina, $target, 'error.' + id, result);
                            if (hFormIsRequired)
                                triggerEvent(gina, $target, 'error.' + id + '.hform', result);
                        }
                        
                        // handle redirect
                        if ( typeof(result) != 'undefined' && typeof(result.location) != 'undefined' ) {                        
                            window.location.hash = ''; //removing hashtag 
                              
                            // if ( window.location.host == gina.config.hostname && /^(http|https)\:\/\//.test(result.location) ) { // same origin
                            //     result.location = result.location.replace( new RegExp(gina.config.hostname), '' );
                            // } else { // external - need to remove `X-Requested-With` from `options.headers`
                                result.location = (!/^http/.test(result.location) && !/^\//.test(result.location) ) ? location.protocol +'//' + result.location : result.location;
                            //}                        
                            
                            window.location.href = result.location;
                            return;                        
                        }

                    } else if ( xhr.status != 0) {
                        
                        result = { 'status': xhr.status, 'message': '' };
                        // handling blob xhr error
                        if ( /blob/.test(xhr.responseType) ) {
                                                        
                            blob = new Blob([this.response], { type: 'text/plain' });
                            
                            var reader = new FileReader(), blobError = '';
                            
                            // This fires after the blob has been read/loaded.
                            reader.addEventListener('loadend', (e) => {
                                
                                if ( /string/i.test(typeof(e.srcElement.result)) ) {
                                    blobError += e.srcElement.result;
                                    // try {
                                    //     result = merge( result, JSON.parse(blobError) )
                                    // } catch (err) {
                                    //     result = merge(result, err)
                                    // }
    
                                } else if ( typeof(e.srcElement.result) == 'object' ) {
                                    result = merge(result, e.srcElement.result)
                                } else {
                                    result.message += e.srcElement.result
                                }
                                
                                // once ready
                                if ( /2/.test(reader.readyState) ) {
                                    
                                    if ( /^(\{|\[)/.test( blobError ) ) {
                                        try {
                                            result = merge( result, JSON.parse(blobError) )
                                        } catch(err) {
                                            result = merge(result, err)
                                        }                                        
                                    }
                                    
                                    if (!result.message)
                                        delete result.message;
                                    
                                    $form.eventData.error = result;

                                    // forward appplication errors to forms.errors when available
                                    if ( typeof(result) != 'undefined' && typeof(result.error) != 'undefined' &&  result.error.fields && typeof(result.error.fields) == 'object') {
                                        var formsErrors = {}, errCount = 0;
                                        for (var f in result.error.fields) {
                                            ++errCount;
                                            formsErrors[f] = { isApplicationValidationError: result.error.fields[f] };
                                        }

                                        if (errCount > 0) {
                                            handleErrorsDisplay($form.target, formsErrors);
                                        }
                                    }

                                    // update toolbar
                                    XHRData = result;
                                    if ( gina && typeof(window.ginaToolbar) == "object" && XHRData ) {
                                        try {
                                            // update toolbar
                                            window.ginaToolbar.update('data-xhr', XHRData );

                                        } catch (err) {
                                            throw err
                                        }
                                    }

                                    triggerEvent(gina, $target, 'error.' + id, result);
                                    if (hFormIsRequired)
                                        triggerEvent(gina, $target, 'error.' + id + '.hform', result);
                                }
                                
                                    
                            });

                            // Start reading the blob as text.
                            reader.readAsText(blob);
                            
                        } else { // normal case
                            
                            if ( /^(\{|\[).test( xhr.responseText ) /) {

                                try {
                                    result = merge( result, JSON.parse(xhr.responseText) )
                                } catch (err) {
                                    result = merge(result, err)
                                }

                            } else if ( typeof(xhr.responseText) == 'object' ) {
                                result = merge(result, xhr.responseText)
                            } else {
                                result.message = xhr.responseText
                            }

                            $form.eventData.error = result;

                            // forward appplication errors to forms.errors when available
                            if ( typeof(result) != 'undefined' && typeof(result.error) != 'undefined' &&  result.error.fields && typeof(result.error.fields) == 'object') {
                                var formsErrors = {}, errCount = 0;
                                for (var f in result.error.fields) {
                                    ++errCount;
                                    formsErrors[f] = { isApplicationValidationError: result.error.fields[f] };
                                }

                                if (errCount > 0) {
                                    handleErrorsDisplay($form.target, formsErrors);
                                }
                            }

                            // update toolbar
                            XHRData = result;
                            if ( gina && typeof(window.ginaToolbar) == "object" && XHRData ) {
                                try {
                                    // update toolbar
                                    window.ginaToolbar.update('data-xhr', XHRData );

                                } catch (err) {
                                    throw err
                                }
                            }

                            triggerEvent(gina, $target, 'error.' + id, result);
                            if (hFormIsRequired)
                                triggerEvent(gina, $target, 'error.' + id + '.hform', result);
                                
                            // handle redirect
                            // if ( typeof(result) != 'undefined' && typeof(result.location) != 'undefined' ) {                        
                            //     window.location.hash = ''; //removing hashtag                            
                            //     result.location = (!/^http/.test(result.location) && !/^\//.test(result.location) ) ? location.protocol +'//' + result.location : result.location;
                            //     window.location.href = result.location;
                            //     return;                        
                            // }
                                                         
                        }

                            
                    }
                }
            };

            // catching request progress
            xhr.onprogress = function(event) {
                
                var percentComplete = '0';
                if (event.lengthComputable) {
                    percentComplete = event.loaded / event.total;
                    percentComplete = parseInt(percentComplete * 100);

                }

                //var percentComplete = (event.position / event.totalSize)*100;
                var result = {
                    'status': 100,
                    'progress': percentComplete
                };

                $form.eventData.onprogress = result;

                triggerEvent(gina, $target, 'progress.' + id, result)
            };

            // catching timeout
            xhr.ontimeout = function (event) {
                result = {
                    'status': 408,
                    'error': 'Request Timeout'
                };

                $form.eventData.ontimeout = result;

                triggerEvent(gina, $target, 'error.' + id, result);
                if (hFormIsRequired)
                    triggerEvent(gina, $target, 'error.' + id + '.hform', result);
            };


            // sending
            if (!data)
                data = event.detail.data;

            if (data) {

                var hasBinaries = false;
                
                if ( typeof(data) == 'object' ) {

                    var binaries    = []
                        , b         = 0;

                    try {
                        if ( !(data instanceof FormData) ) {
                            data = JSON.stringify(data)
                        } else {
                            var newData = {};
                            for (var [key, value] of data.entries()) {
                                // file upload case
                                if (value instanceof File) {
                                    if (!hasBinaries)
                                        hasBinaries = true;

                                    binaries[b] = {
                                        key: key,
                                        file: value,
                                        bin: ''
                                    };
                                   
                                    ++b;
                                } else {
                                    newData[key] = value
                                }
                                
                            }
                        }

                        
                        if (hasBinaries && binaries.length > 0) {

                            // We need a separator to define each part of the request
                            var boundary = '--ginaWKBoundary' + uuid.v4().replace(/\-/g, ''); 
                            
                            
                            return processFiles(binaries, boundary, '', 0, function onComplete(err, data, done) {
                                
                                if (err) {
                                    throw err
                                } else {

                                    if (done) {
                                        xhr.setRequestHeader('Content-Type', 'multipart/form-data; boundary=' + boundary);
                                        xhr.send(data);

                                        $form.sent = true;
                                    }

                                    done = false;

                                    return false;
                                }                                
                            });
                            
                        } else if ( typeof(newData) != 'undefined' ) { // without file
                            data = JSON.stringify(newData)
                        }
                        
                        
                    } catch (err) {
                        triggerEvent(gina, $target, 'error.' + id, err);
                        if (hFormIsRequired)
                            triggerEvent(gina, $target, 'error.' + id + '.hform', err);
                    }
                }
                //console.log('sending -> ', data);
                //try {
                if (!hasBinaries) {
                //     var intervalID = null;
                //     intervalID = setInterval(function onTotalReadersCheck() {
                //         if (totalReaders <= 0) {
                            
                //             // rather than letting XMLHttpRequest decode the data first.
                //             //xhr.responseType = 'arraybuffer';
                //             //xhr.setRequestHeader('Content-Type', null);
                //             xhr.setRequestHeader('Content-Type', 'multipart/form-data; boundary=' + boundary);                                                        
                //             xhr.send(data);
                            
                //             clearInterval(intervalID);
                //         }
                //     }, 200);
                // } else {

                    if (typeof (enctype) != 'undefined' && enctype != null && enctype != '') {
                        xhr.setRequestHeader('Content-Type', enctype);
                    }

                    xhr.send(data)
                }
                    
                // } catch (err) {
                //     XHRData = result;
                //     if ( gina && typeof(window.ginaToolbar) == "object" && XHRData ) {
                //         try {
                //
                //             if ( typeof(XHRData) != 'undefined' ) {
                //                 window.ginaToolbar.update("data-xhr", XHRData);
                //             }
                //
                //         } catch (err) {
                //             throw err
                //         }
                //     }
                // }

            } else {

                if ( typeof(enctype) != 'undefined' && enctype != null && enctype != ''){
                    xhr.setRequestHeader('Content-Type', enctype);
                }

                xhr.send()
            }

            $form.sent = true;
        }
    }

    

    /**
     * Convert <Uint8Array|Uint16Array|Uint32Array> to <String>
     * @param {array} buffer
     * @param {number} [byteLength] e.g.: 8, 16 or 32
     * 
     * @return {string} stringBufffer
     */
    var ab2str = function(buf, byteLength) {

        var str = '';
        var ab = null;

        if ( typeof(byteLength) == 'undefined' ) {
            var byteLength = 8;
        }

        
        var bits = (byteLength / 8) 


        switch (byteLength) {
            case 8:
                ab = new Uint8Array(buf);
                break;
            case 16:
                ab = new Uint16Array(buf);
                break;

            case 32:
                ab = new Uint32Array(buf);
                break;
                
            default:
                ab = new Uint8Array(buf);      
                break;      

        }


        var abLen = ab.length;
        var CHUNK_SIZE = Math.pow(2, 8) + bits;
        var offset = null, len = null, subab = null;
        
        for (offset = 0; offset < abLen; offset += CHUNK_SIZE) {
            len = Math.min(CHUNK_SIZE, abLen - offset);
            subab = ab.subarray(offset, offset + len);
            str += String.fromCharCode.apply(null, subab);
        }
        return str;
    }


    var processFiles = function(binaries, boundary, data, f, onComplete) {

        var reader = new FileReader();

        reader.addEventListener('load', function onReaderLoaded(e) {

            e.preventDefault();

            try {
                
                var bin = ab2str(this.result);                
                binaries[this.index].bin += bin;

                if (!binaries[this.index].file.type) {
                    binaries[this.index].file.type = 'application/octet-stream'
                }

            } catch (err) {
                return onComplete(err, null, true);
            }

            // Start a new part in our body's request
            data += "--" + boundary + "\r\n";

            // Describe it as form data
            data += 'Content-Disposition: form-data; '

                // Define the name of the form data
                + 'name="' + binaries[this.index].key + '"; '

                // Provide the real name of the file
                + 'filename="' + binaries[this.index].file.name + '"\r\n';


            // And the MIME type of the file
            data += 'Content-Type: ' + binaries[this.index].file.type + '\r\n';
            

            // File length
            data += 'Content-Length: ' + binaries[this.index].bin.length + '\r\n';

            // There's a blank line between the metadata and the data
            data += '\r\n';

            // Append the binary data to our body's request
            data += binaries[this.index].bin + '\r\n';

            ++this.index;
            // is last file ?
            if (this.index == binaries.length) {

                // Once we are done, "close" the body's request
                data += "--" + boundary + "--";

                onComplete(false, data, true);

            } else { // process next file
                processFiles(binaries, boundary, data, this.index, onComplete)
            }

            
        }, false);

        reader.index = f;
        binaries[f].bin = '';

        reader.readAsArrayBuffer(binaries[f].file);
        //reader.readAsBinaryString(binaries[f].file);
    }

    
    var listenToXhrEvents = function($form) {


        //data-gina-form-event-on-submit-success
        var htmlSuccesEventCallback =  $form.target.getAttribute('data-gina-form-event-on-submit-success') || null;
        if (htmlSuccesEventCallback != null) {

            if ( /\((.*)\)/.test(htmlSuccesEventCallback) ) {
                eval(htmlSuccesEventCallback)
            } else {
                $form.on('success.hform',  window[htmlSuccesEventCallback])
            }
        }

        //data-gina-form-event-on-submit-error
        var htmlErrorEventCallback =  $form.target.getAttribute('data-gina-form-event-on-submit-error') || null;
        if (htmlErrorEventCallback != null) {
            if ( /\((.*)\)/.test(htmlErrorEventCallback) ) {
                eval(htmlErrorEventCallback)
            } else {
                $form.on('error.hform', window[htmlErrorEventCallback])
            }
        }
    }

    var destroy = function(formId) {
        var $form = null, _id = formId;


        if ( !instance['$forms'] )
            throw new Error('`$forms` collection not found');


        if ( typeof(_id) == 'undefined') {
            if ( typeof(this.id) != 'undefined' && this.id != '' && this.id != null ) {
                _id  = this.id
            } else {
                throw new Error('[ FormValidator::destroy(formId) ] `formId` is missing')
            }
        }

        if ( typeof(_id) == 'string') {
            _id = _id.replace(/\#/, '')
        } else if ( typeof(_id) == 'object' && !Array.isArray(_id) ) { // weird exception
            var $target = _id.form;
            _id = $target.getAttribute('id') || 'form.'+uuid.v4();

            $target.setAttribute('id', _id);// just in case

        } else {
            throw new Error('[ FormValidator::destroy(formId) ] `formId` should be a `string`');
        }

        if ( typeof(instance['$forms'][_id]) != 'undefined' ) {
            $form = instance['$forms'][_id]
        } else if ( typeof(this.binded) != 'undefined' ) {
            $form = this;
        }

        if ($form) {
            // remove existing listeners

            // form events
            removeListener(gina, $form, 'success.' + _id);
            removeListener(gina, $form, 'error.' + _id);

            if ($form.target.getAttribute('data-gina-form-event-on-submit-success'))
                removeListener(gina, $form, 'success.' + _id + '.hform');
                
            if ($form.target.getAttribute('data-gina-form-event-on-submit-error'))
                removeListener(gina, $form, 'error.' + _id + '.hform');

            removeListener(gina, $form, 'validate.' + _id);
            removeListener(gina, $form, 'submit.' + _id);
            
            

            // binded elements
            var $el         = null
                , evt       = null
                , $els      = []
                , $elTMP    = [];

            // submit buttons
            $elTMP = $form.target.getElementsByTagName('button');
            if ( $elTMP.length > 0 ) {
                for(var i = 0, len = $elTMP.length; i < len; ++i) {
                    if ($elTMP[i].type == 'submit')
                        $els.push($elTMP[i])
                }
            }

            // submit links
            $elTMP = $form.target.getElementsByTagName('a');
            if ( $elTMP.length > 0 ) {
                for(var i = 0, len = $elTMP.length; i < len; ++i) {
                    if ( $elTMP[i].attributes.getNamedItem('data-gina-form-submit') || /^click\./.test( $elTMP[i].attributes.getNamedItem('id') ) || /^link\./.test( $elTMP[i].attributes.getNamedItem('id') ) )
                        $els.push($elTMP[i])
                }
            }

            // checkbox & radio
            $elTMP = $form.target.getElementsByTagName('input');
            if ( $elTMP.length > 0 ) {
                for(var i = 0, len = $elTMP.length; i < len; ++i) {
                    if ($elTMP[i].type == 'checkbox' || $elTMP[i].type == 'radio' )
                        $els.push( $elTMP[i] )
                }
            }

            for (var i = 0, len = $els.length; i < len; ++i) {

                $el = $els[i];

                if ($el.type == 'submit') {

                    evt = $el.getAttribute('id');
                    if ( typeof(gina.events[ evt ]) != 'undefined' )
                        removeListener(gina, $el, gina.events[ evt ]);

                } else {

                    evt ='click.' + $el.getAttribute('id');
                    if ( typeof(gina.events[ evt ]) != 'undefined' )
                        removeListener(gina, $el, evt);
                }
            }

            $form.binded = false;

            addListener(gina, $form.target, 'destroy.' + _id, function(event) {

                cancelEvent(event);

                delete instance['$forms'][_id];
                removeListener(gina, event.currentTarget, event.type);
                removeListener(gina, event.currentTarget,'destroy');
            });

            //triggerEvent(gina, instance['$forms'][_id].target, 'destroy.' + _id);
            triggerEvent(gina, $form.target, 'destroy.' + _id);

        } else {
            throw new Error('[ FormValidator::destroy(formId) ] `'+_id+'` not found');
        }

    }

    var checkForRulesImports = function (rules) {
        // check if rules has imports & replace
        var rulesStr = JSON.stringify(rules, null, 4);
        var importedRules = rulesStr.match(/(\"@import\s+[a-z A-Z 0-9/.]+\")/g);
        if (!instance.rules) {
            instance.rules = {}
        }
        if (importedRules && importedRules.length > 0) {
            var ruleArr = [], rule = {}, tmpRule = null;
            for (var r = 0, len = importedRules.length; r<len; ++r) {
                ruleArr = importedRules[r].replace(/(@import\s+|\"|\')/g, '').split(/\s/g);
                // [""@import client/form", ""@import project26/edit demo/edit"]
                //console.log('ruleArr -> ', ruleArr, importedRules[r]);
                for (var i = 0, iLen = ruleArr.length; i<iLen; ++i) {
                    tmpRule = ruleArr[i].replace(/\//g, '.');
                    if ( typeof(instance.rules[ tmpRule ]) != 'undefined' ) {
                        rule = merge(rule, instance.rules[ tmpRule ])
                    } else {
                        console.warn('[formValidator:rules] <@import error> on `'+importedRules[r]+'`: rule `'+ruleArr[i]+'` not found. Ignoring.');
                        continue;
                    }
                }
                //console.log('replacing ', importedRules[r]);
                rulesStr = rulesStr.replace(importedRules[r], JSON.stringify(rule));
                instance.rules = JSON.parse( JSON.stringify(instance.rules).replace( new RegExp(importedRules[r], 'g'), JSON.stringify(rule)) );
                //console.log('str ', rulesStr);
                rule = {}

            }

            // if (!instance.rules) {
            //     instance.rules = {}
            // }

            
            rules = JSON.parse(rulesStr);
            parseRules(rules, '');

            // if (!isGFFCtx) {
            //     backendProto.rules = instance.rules
            // }
        }
    }

    var init = function (rules) {

        if (gina.hasValidator) {
            instance = merge(instance, gina.validator);
            instance.on('init', function(event) {
                instance.isReady = true;
                triggerEvent(gina, instance.target, 'ready.' + instance.id, instance)
            })
        } else {
            setupInstanceProto();
            instance.on('init', function(event) {
                // parsing rules
                if ( typeof(rules) != 'undefined' && rules.count() ) {
                    try {
                        // making copy
                        gina.forms.rules = JSON.parse(JSON.stringify(rules));
                        
                        parseRules(rules, '');
                        checkForRulesImports(rules);
                    } catch (err) {
                        throw (err)
                    }
                }

                $validator.setOptions           = setOptions;
                $validator.getFormById          = getFormById;
                $validator.validateFormById     = validateFormById;
                $validator.resetErrorsDisplay   = resetErrorsDisplay;
                $validator.resetFields          = resetFields;
                $validator.handleErrorsDisplay  = handleErrorsDisplay;
                $validator.submit               = submit;
                $validator.send                 = send;
                $validator.destroy              = destroy;

                var id          = null
                    , $target   = null
                    , i         = 0
                    , $forms    = []
                    , $allForms = document.getElementsByTagName('form');


                // has rule ?
                for (var f=0, len = $allForms.length; f<len; ++f) {
                    // preparing prototype (need at least an ID for this)

                    if ($allForms[f].getAttribute) {
                        id = $allForms[f].getAttribute('id') || 'form.' + uuid.v4();
                        if ( id !== $allForms[f].getAttribute('id') ) {
                            $allForms[f].setAttribute('id', id)
                        }
                    } else {
                        id = 'form.' + uuid.v4();
                        $allForms[f].setAttribute('id', id)
                    }

                    $allForms[f]['id'] = $validator.id = id;

                    if ( typeof($allForms[f].id) != 'undefined' && $allForms[f].id != 'null' && $allForms[f].id != '') {

                        $validator.target = $allForms[f];
                        instance.$forms[$allForms[f].id] = merge({}, $validator);

                        var customRule = $allForms[f].getAttribute('data-gina-form-rule');

                        if (customRule) {
                            customRule = customRule.replace(/\-/g, '.');
                            if ( typeof(instance.rules[customRule]) == 'undefined' ) {
                                //customRule = null;   
                                throw new Error('['+$allForms[f].id+'] no rule found with key: `'+customRule+'`. Please check if json is not malformed @ /forms/rules/' + customRule.replace(/\./g, '/') +'.json');        
                            } else {
                                customRule = instance.rules[customRule]
                            }
                        }

                        // finding forms handled by rules
                        if ( typeof($allForms[f].id) == 'string' && typeof(instance.rules[$allForms[f].id.replace(/\-/g, '.')]) != 'undefined' ) {
                            $target = instance.$forms[$allForms[f].id].target;
                            if (customRule) {
                                bindForm($target, customRule)
                            } else {
                                bindForm($target)
                            }

                            ++i
                        } else {
                            // weird exception when having in the form an element with name="id"
                            if ( typeof($allForms[f].id) == 'object' ) {
                                delete instance.$forms[$allForms[f].id];

                                var _id = $allForms[f].attributes.getNamedItem('id').nodeValue || 'form.'+uuid.v4();

                                $allForms[f].setAttribute('id', _id);
                                $allForms[f]['id'] = _id;

                                $validator.target = $allForms[f];
                                instance.$forms[_id] = merge({}, $validator);

                                $target = instance.$forms[_id].target;
                                if (customRule) {
                                    bindForm($target, customRule)
                                } else {
                                    bindForm($target)
                                }
                            } else {

                                $target = instance.$forms[$allForms[f].id].target;
                                if (customRule) {
                                    bindForm($target, customRule)
                                } else {
                                    bindForm($target)
                                }
                            }
                        }
                    }

                }


                // setting up AJAX
                if (window.XMLHttpRequest) { // Mozilla, Safari, ...
                    xhr = new XMLHttpRequest();
                } else if (window.ActiveXObject) { // IE
                    try {
                        xhr = new ActiveXObject("Msxml2.XMLHTTP");
                    } catch (e) {
                        try {
                            xhr = new ActiveXObject("Microsoft.XMLHTTP");
                        }
                        catch (e) {}
                    }
                }

                instance.isReady = true;
                gina.hasValidator = true;
                gina.validator = instance;
                triggerEvent(gina, instance.target, 'ready.' + instance.id, instance);
            });

        }

        instance.initialized = true;
        return instance
    }

    var initForm = function ($form) {

        var customRule = null;

        if ($form.getAttribute) {
            id = $form.getAttribute('id') || 'form.' + uuid.v4();
            if (id !== $form.getAttribute('id')) {
                $form.setAttribute('id', id)
            }
        } else {
            id = 'form.' + uuid.v4();
            $form.setAttribute('id', id)
        }

        $form.id = $validator.id = id;

        if (typeof ($form.id) != 'undefined' && $form.id != 'null' && $form.id != '') {

            $validator.target = $form;
            instance.$forms[$form.id] = merge({}, $validator);

            customRule = $form.getAttribute('data-gina-form-rule');

            if (customRule) {
                customRule = customRule.replace(/\-/g, '.');
                if (typeof (instance.rules[customRule]) == 'undefined') {
                    customRule = null;
                    throw new Error('[' + $form.id + '] no rule found with key: `' + customRule + '`');
                } else {
                    customRule = instance.rules[customRule]
                }
            }

            // finding forms handled by rules
            if (typeof ($form.id) == 'string' && typeof (instance.rules[$form.id.replace(/\-/g, '.')]) != 'undefined') {
                $target = instance.$forms[$form.id].target;
                if (customRule) {
                    bindForm($target, customRule)
                } else {
                    bindForm($target)
                }

            } else {
                // weird exception when having in the form an element with name="id"
                if (typeof ($form.id) == 'object') {
                    delete instance.$forms[$form.id];

                    var _id = $form.attributes.getNamedItem('id').nodeValue || 'form.' + uuid.v4();

                    $form.setAttribute('id', _id);
                    $form.id = _id;

                    $validator.target = $form;
                    instance.$forms[_id] = merge({}, $validator);

                    $target = instance.$forms[_id].target;
                    if (customRule) {
                        bindForm($target, customRule)
                    } else {
                        bindForm($target)
                    }
                } else {

                    $target = instance.$forms[$form.id].target;
                    if (customRule) {
                        bindForm($target, customRule)
                    } else {
                        bindForm($target)
                    }
                }
            }
        }        
    }

    /**
     * parseRules - Preparing rules paths
     *
     * @param {object} rules
     * @param {string} tmp - path
     * */
    var parseRules = function(rules, tmp) {
        var _r = null;
        for (var r in rules) {

            if ( typeof(rules[r]) == 'object' && typeof(instance.rules[tmp + r]) == 'undefined' ) {

                _r = r;
                if (/\[|\]/.test(r) ) { // must be a real path
                    _r = r.replace(/\[/g, '.').replace(/\]/g, '');
                }

                instance.rules[tmp + _r] = rules[r];
                //delete instance.rules[r];
                parseRules(rules[r], tmp + _r +'.');
            }
        }
    }

    var makeObjectFromArgs = function(root, args, obj, len, i, value) {

        var key = args[i].replace(/^\[|\]$/g, '');


        if (i == len - 1) { // end
            obj[key] = value

            return root
        }

        var nextKey = args[i + 1].replace(/^\[|\]$/g, '');

        if (typeof (obj[key]) == 'undefined') {

            if (/^\d+$/.test(nextKey)) { // collection index ?
                obj[key] = [];
            } else {
                obj[key] = {};
            }

            ++i;

            return makeObjectFromArgs(root, args, obj[key], len, i, value);
        }


        for (var k in obj) {

            if (k == key) {
                ++i;
                return makeObjectFromArgs(root, args, obj[key], len, i, value);
            }
        }
    }

    /**
     * makeObject - Preparing form data
     *
     * @param {object} obj - data
     * @param {string\number\boolean} value
     * @param {array} string
     * @param {number} len
     * @param {number} i
     *
     * */
    var makeObject = function (obj, value, args, len, i) {

        if (i >= len) {
            return false
        }

        var key     = args[i].replace(/^\[|\]$/g, '');
        var nextKey = ( i < len-1 && typeof(args[i+1]) != 'undefined' ) ?  args[i+1].replace(/^\[|\]$/g, '') : null;

        if ( typeof(obj[key]) == 'undefined' ) {
            if (nextKey && /^\d+$/.test(nextKey)) {
                nextKey = parseInt(nextKey);
                obj[key] = []
            } else {
                obj[key] = {}
            }
        }

        if ( Array.isArray(obj[key]) ) {
            makeObjectFromArgs(obj[key], args, obj[key], args.length, 1, value);
        } else {
            if (i == len - 1) {
                obj[key] = value;
            } else {
                makeObject(obj[key], value, args, len, i + 1)
            }
        }

        // for (var o in obj) {

        //     if ( typeof(obj[o]) == 'object' ) {

        //         if ( Array.isArray(obj[o]) ) {


        //             if (o === key) {

        //                 // var _args = JSON.parse(JSON.stringify(args));
        //                 // _args.splice(0, 1);

        //                 // for (var a = i, aLen = _args.length; a < aLen; ++a) {
        //                 //     key = _args[a].replace(/^\[|\]$/g, '');
        //                 //     if ( /^\d+$/.test(key) ) {
        //                 //         key = parseInt(key)
        //                 //     }
        //                 //     obj[o][nextKey] = {};

        //                 //     if (a == aLen-1) {
        //                 //         obj[o][nextKey][key] = value;
        //                 //     }
        //                 // }
        //                 //obj[o] = makeObjectFromArgs(obj[o], args, obj[o], args.length, 0, value);
        //                 makeObjectFromArgs(obj[o], args, obj[o], args.length, 0, value);
                        
        //             }

        //         } else if ( o === key ) {

        //             if (i == len-1) {
        //                 obj[o] = value;
        //             } else {
        //                 makeObject(obj[o], value, args, len, i+1)
        //             }
        //         }
        //     }
        // }

    }

    var formatData = function (data) {

        var args        = null
            , obj       = {}
            , key       = null
            , fields    = {};

        for (var name in data) {

            if ( /\[(.*)\]/.test(name) ) {
                // backup name key
                key = name;

                // properties
                args    = name.match(/(\[[-_\[a-z 0-9]*\]\]|\[[-_\[a-z 0-9]*\])/ig);

                // root
                name    = name.match(/^[-_a-z 0-9]+\[{0}/ig);

                // building object tree
                makeObject(obj, data[key], args, args.length, 0);

                //if ( Array.isArray(obj) ) {
                //    fields[name] = merge(fields[name], obj);
                //} else {
                    fields[name] = merge(fields[name], obj);
                //}
                
                obj = {}

            } else {
                fields[name] = data[name];
            }
        }

        return fields
    }


    /**
     * bindForm
     *
     * @param {object} $target - DOM element
     * @param {object} [customRule]
     * */
    var bindForm = function($target, customRule) {

        var $form = null, _id = null;

        try {
            if ( $target.getAttribute && $target.getAttribute('id') ) {
                _id = $target.getAttribute('id');
                if ( typeof(instance.$forms[_id]) != 'undefined')
                    $form = instance.$forms[_id];
                else
                    throw new Error('form instance `'+ _id +'` not found');

            } else {
                throw new Error('Validator::bindForm($target, customRule): `$target` must be a DOM element\n'+err.stack )
            }
        } catch(err) {
            throw new Error('Validator::bindForm($target, customRule) could not bind form `'+ $target +'`\n'+err.stack )
        }

        if ( typeof($form) != 'undefined' && $form.binded) {
            return false
        }

        var withRules = false, rule = null, evt = '', procced = null;

        if ( typeof(customRule) != 'undefined' || typeof(_id) == 'string' && typeof(instance.rules[_id.replace(/\-/g, '.')]) != 'undefined' ) {
            withRules = true;

            if ( customRule && typeof(customRule) == 'object' ) {
                rule = customRule
            } else if ( customRule && typeof(customRule) == 'string' && typeof(instance.rules[customRule.replace(/\-/g, '.')]) != 'undefined') {
                rule = instance.rules[customRule.replace(/\-/g, '.')]
            } else {
                rule = instance.rules[_id.replace(/\-/g, '.')]
            }

            $form.rules = rule
        }

        // form fields collection
        if (!$form.fieldsSet)
            $form.fieldsSet = {};

        // binding form elements
        var type        = null
            , id        = null
            // input: checkbox, radio
            , $inputs   = $target.getElementsByTagName('input')
            // select
            , $select   = $target.getElementsByTagName('select')
            , formElementGroup = {}
            , formElementGroupTmp = null
            , formElementGroupItems = {}
            // file upload
            , $htmlTarget = null
            , uploadTriggerId = null
            , $uploadTrigger = null
            , $upload       = null
            , $progress = null
        ;

        var elId = null;
        for (var f = 0, len = $inputs.length; f < len; ++f) {
            elId = $inputs[f].getAttribute('id');
            if (!elId) {
                elId = 'input.' + uuid.v4();
                $inputs[f].setAttribute('id', elId)
            }

            if (!$form.fieldsSet[ elId ]) {
                $form.fieldsSet[elId] = {
                    id: elId,
                    name: $inputs[f].name || null,
                    value: $inputs[f].value || null
                }
            }
            
            formElementGroupTmp = $inputs[f].getAttribute('data-gina-form-element-group');
            if (formElementGroupTmp) {
                formElementGroup[ $inputs[f].name ] = new RegExp('^'+formElementGroupTmp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
                if (withRules) {
                    if ( typeof($form.rules[ $inputs[f].name ]) == 'undefined') {
                        $form.rules[ $inputs[f].name ] = {}
                    }
                    $form.rules[ $inputs[f].name ].exclude = true;
                }
            }
            
            if ( formElementGroup.count() > 0 ) {
                for ( var g in formElementGroup ) {
                    if ($inputs[f].name == g) continue;
                    
                    if ( formElementGroup[g].test($inputs[f].name) ) {
                        
                        $inputs[f].disabled = true;
                        if ( typeof(formElementGroupItems[ g ]) == 'undefined' ) {
                            formElementGroupItems[ g ] = {}
                        }
                        formElementGroupItems[ g ][ $inputs[f].name ] = $inputs[f];
                    }
                }
            }
            // file upload
            // todo : data-gina-file-autosend="false" when false, don't trigger the sending to the backend
            // todo : progress bar
            // todo : on('success') -> preview
            if ( /^file$/i.test($inputs[f].type) ) {
                
                uploadTriggerId = $inputs[f].getAttribute('data-gina-form-upload-trigger');
                $uploadTrigger = null;
                // `$htmlTarget` cannot be used if you need to add a listner on the searched element
                $htmlTarget = new DOMParser().parseFromString($target.innerHTML, 'text/html');
                if (uploadTriggerId) {                    
                    $uploadTrigger = document.getElementById(uploadTriggerId);
                }                    
                // binding upload trigger
                if ( $uploadTrigger ) {
                    $uploadTrigger.setAttribute('data-gina-form-upload-target', $inputs[f].id);
                    addListener(gina, $uploadTrigger, 'click', function(event) {
                        event.preventDefault();
                        var $el     = event.target;
                         
                        var fileElemId  = $el.getAttribute('data-gina-form-upload-target') || null;   
                        if (fileElemId)
                            $upload = document.getElementById(fileElemId);
                        
                            
                        //$progress = $($(this).parent().find('.progress'));
                        // reset progress bar
                        //$progress.text('0%');
                        //$progress.width('0%');
                        if ($upload) {
                            $upload.value = '';// force reset : != multiple
                            triggerEvent(gina, $upload, 'click', event.detail);  
                        }                                     
                    });
                }
                
                // binding file element == $upload
                addListener(gina, $inputs[f], 'change', function(event) {
                    event.preventDefault();
                    var $el     = event.target;
                    // [0] is for a single file, when multiple == false
                    var files = $el.files;
                    if (!files.length ) return false;
                    
                    // $progress = $($(this).parent().find('.progress'));
                    var url             = $el.getAttribute('data-gina-form-upload-action');      
                    var name            = $el.getAttribute('name');
                    var fileId          = name;                    
                    var uploadFormId    = 'gina-upload-' + name.replace(/\[/g, '-').replace(/\]/g, ''); 
                    var eventOnSuccess  = $el.getAttribute('data-gina-form-upload-on-success');
                    
                    if (files.length > 0) {
                        // create form if not exists
                        var $uploadForm = $htmlTarget.getElementById(uploadFormId);
                        
                        if ( !$uploadForm ) {
                            $uploadForm = document.createElement('form');

                            // adding form attributes
                            $uploadForm.id       = uploadFormId;
                            $uploadForm.action   = url;
                            $uploadForm.enctype  = 'multipart/form-data';
                            $uploadForm.method   = 'POST';
                            
                            if (eventOnSuccess)
                                $uploadForm.setAttribute('data-gina-form-event-on-submit-success', eventOnSuccess);
                            else
                                $uploadForm.setAttribute('data-gina-form-event-on-submit-success', 'onGenericXhrResponse');
                            
                            var previewId = $el.getAttribute('data-gina-form-upload-preview') || null;
                            if (previewId)
                                $uploadForm.setAttribute('data-gina-form-upload-preview', previewId);
                            
                            // adding for to current doccument
                            document.body.appendChild($uploadForm);

                        }
                        
                        // binding form
                        try {
                            var $uploadFormValidator = getFormById(uploadFormId);
                            // create a FormData object which will be sent as the data payload in the          
                            var formData = new FormData();
                            // add the files to formData object for the data payload
                            var file = null;          
                            for (var l = 0, lLen = files.length; l < lLen; ++l) {
                                file = files[l];
                                formData.append(fileId, file, file.name);
                            }
                            
                            $uploadFormValidator
                                .on('error', function(e, result) {
                                    console.error('[error] ', '\n(e)' + e, '\n(result)' + result)
                                })
                                .on('success', function(e, result){
                                    
                                    var $el = e.target;
                                    var $preview = null, $ul = null, $li = null, $img = null;
                                    var previewId = $el.getAttribute('data-gina-form-upload-preview') || null;
                                    if (previewId)
                                        $preview = document.getElementById(previewId);
                                    
                                    console.log('gina says -> ', e, result);
                                    
                                    var files = result.files;
                                    if ($preview) {
                                        $preview.innerHTML = '';
                                        $ul = document.createElement("ul");
                                        for (var f = 0, fLen = files.length; f<fLen; ++f) {
                                            $li = document.createElement("li");
                                            $img = document.createElement("img");
                                            
                                            $img.src = files[f].tmpSrc;
                                            $img.width = files[f].width;
                                            $img.height = files[f].height;
                                            
                                            $li.appendChild($img);
                                            $ul.appendChild($li);
                                        }
                                        $preview.appendChild($ul);
                                    }
                                     
                                })
                                /**.on('progress', function(evt, result) {
                    
                                percentComplete = result.progress;
                    
                                $progress.text(percentComplete + '%');
                                $progress.width(percentComplete + '%');
                    
                                if (percentComplete === 100) {
                                    $progress.html('Done');
                                }
                    
                                // if (evt.lengthComputable) {
                                //   // calculate the percentage of upload completed
                                //   var percentComplete = evt.loaded / evt.total;
                                //   percentComplete = parseInt(percentComplete * 100);
                    
                                //   // update the Bootstrap progress bar with the new percentage
                                //   $progress.text(percentComplete + '%');
                                //   $progress.width(percentComplete + '%');
                    
                                //   // once the upload reaches 100%, set the progress bar text to done
                                //   if (percentComplete === 100) {
                                //     $progress.html('Done');
                                //   }
                    
                                // }
                                }) */            
                                .send(formData, { withCredentials: true/*, isSynchrone: true*/ });
                            
                        } catch (formErr) {
                            throw formErr;
                        }
                        
                    }
                    
                });
                
                
            }
        }

        var updateSelect = function($el) {
            //var selectedIndex = $el.selectedIndex;
            //var isBoolean = /^(true|false)$/i.test($el.value);
            
            $el.setAttribute('data-value', $el.value);
        };
        
        var selectedIndex = null, selectedValue = null;
        for (var s = 0, sLen = $select.length; s < sLen; ++s) {
            elId = $select[s].getAttribute('id');

            if (elId && /^gina\-toolbar/.test(elId)) continue;

            if (!elId) {
                elId = 'select.' + uuid.v4();
                $select[s].setAttribute('id', elId)
            }
            
            addListener(gina, $select[s], 'change', function(event) {
                var $el = event.target;
                
                if (/select/i.test($el.type) ) {                    
                    updateSelect($el);
                }                
            });

            if ($select[s].options && !$form.fieldsSet[ elId ]) {
                selectedIndex = 0;
                selectedValue = $select[s].getAttribute('data-value') || null;
                if ( selectedValue ) {
                    for (var o = 0, oLen = $select[s].options.length; o < oLen; ++o ) {
                        if ( $select[s].options[o].value == selectedValue) {
                            selectedIndex = o;
                            $select[s].selectedIndex = selectedIndex;
                            break
                        }
                    }
                }
                
                if ( typeof($select[s].options[$select[s].selectedIndex]) != 'undefined' && $select[s].options[ $select[s].selectedIndex ].index ) {
                    selectedIndex = $select[s].options[ $select[s].selectedIndex ].index
                }/** else if ( typeof(selectedValue) != 'undefined' ) {
                    for (var o = 0, oLen = $select[s].options.length; o < oLen; ++o ) {
                        if ( $select[s].options[o].value == selectedValue) {
                            selectedIndex = o;
                            break
                        }
                    }
                }*/

                $form.fieldsSet[ elId ] = {
                    id: elId,
                    name: $select[s].name || null,
                    value: selectedIndex || null
                };

                // update select
                if ( typeof($select[s].options[selectedIndex]) != 'undefined' ) {
                    $select[s].options[ selectedIndex ].selected = true;
                    $select[s].setAttribute('data-value',  $select[s].options[ selectedIndex ].value);
                }

            }
        }        

        var updateCheckBox = function($el) {

            var checked     = $el.checked;
            // set to checked if not checked: false -> true
            if ( !checked || checked == 'null' || checked == 'false' || checked == '' ) {

                // prevents ticking behavior
                setTimeout(function () {
                    $el.checked = false;
                }, 0);

                $el.removeAttribute('checked');
                $el.value = false;
                $el.setAttribute('value', 'false');
                
                if ( typeof($el.getAttribute('data-value') != 'undefined' ) )
                    $el.setAttribute('data-value', 'false');
                                   
            } else {                
                
                // prevents ticking behavior
                setTimeout(function () {
                    $el.checked = true;
                }, 0);

                $el.setAttribute('checked', 'checked');
                //boolean exception handling
                $el.value = true;
                $el.setAttribute('value', 'true');
                
                if ( typeof($el.getAttribute('data-value') != 'undefined' ) )
                    $el.setAttribute('data-value', 'true');
                    
            }
            
            // group dependencies handling
            if ( $el.getAttribute('data-gina-form-element-group') ) {
                var elGroup = formElementGroupItems[$el.name];
                for ( var item in elGroup ) {  
                    if (withRules && typeof($form.rule[item]) == 'undefined' ) { 
                        $form.rule[item] = {}
                    }                  
                    if ( /^true$/.test($el.value) ) {
                        elGroup[item].disabled = false;
                        if (withRules) {
                            $form.rules[item].exclude = false;
                        }
                    } else {
                        elGroup[item].disabled = true;
                        if (withRules) {
                            $form.rules[item].exclude = true;
                        }
                    }
                }
            }
            
        };

        var radioGroup = null;
        var updateRadio = function($el, isInit) {
            var checked = $el.checked;
            var isBoolean = /^(true|false)$/i.test($el.value);
            

            // loop if radio group
            if (!isInit) {
                radioGroup = document.getElementsByName($el.name);
                //console.log('found ', radioGroup.length, radioGroup)
                for (var r = 0, rLen = radioGroup.length; r < rLen; ++r) {
                    if (radioGroup[r].id !== $el.id) {
                        radioGroup[r].checked = false;
                        radioGroup[r].removeAttribute('checked');
                    }
                }
            }

            

            if ( !checked || checked == 'null' || checked == 'false' || checked == '' ) {

                // prevents ticking behavior
                setTimeout(function () {
                    $el.checked = false;
                }, 0)

                $el.removeAttribute('checked');

                //if (isBoolean) {
                //    $el.value = false;
                //}

                // if (isBoolean) { // force boolean value
                //     $el.value = (/^true$/.test($el.value)) ? true : false
                // }
                

            } else {

                // prevents ticking behavior
                setTimeout(function () {
                    $el.checked = true;
                }, 0)

                $el.setAttribute('checked', 'checked');
                //$el.value = $el.getAttribute('value');

                //if (isBoolean) { // no multiple choice supported
                //    $el.value = true;
                //}

                

                radioGroup = document.getElementsByName($el.name);
                //console.log('found ', radioGroup.length, radioGroup)
                for (var g = 0, gLen = radioGroup.length; g < gLen; ++g) {
                    if (radioGroup[g].id !== $el.id) {
                        radioGroup[g].checked = false;
                        radioGroup[g].removeAttribute('checked');
                        
                        // if (isBoolean) {
                        //     radioGroup[g].value = false;
                        // }
                        // if ( /^(true|false)$/.test($el.value) ) {
                        //     radioGroup[g].value = (/^true$/.test(radioGroup[g].value)) ? true : false
                        // }
                        
                    }
                }

                // if (isBoolean) { // force boolean value
                //     $el.value = ( /^true$/.test($el.value) ) ? true : false
                // }
            }

            if (isBoolean) { // force boolean value
                $el.value = (/^true$/.test($el.value)) ? true : false
            }
        }
                               

        evt = 'click';

        procced = function () {
            
            
            
            // click proxy            
            addListener(gina, $target, 'click', function(event) {
                
                var $el = event.target;
                
                if (
                    /(label)/i.test(event.target.tagName) && typeof(event.target.control) != 'undefined' && event.target.control != null && /(checkbox|radio)/i.test(event.target.control.type) 
                    || /(label)/i.test(event.target.parentNode.tagName) && typeof(event.target.parentNode.control) != 'undefined' && event.target.parentNode.control != null && /(checkbox|radio)/i.test(event.target.parentNode.control.type) 
                ) {                    
                    // if `event.target.control` not working on all browser,
                    // try to detect `for` attribute OR check if on of the label's event.target.children is an input & type == (checkbox|radio)
                    $el = event.target.control || event.target.parentNode.control;
                    if ( !$el.disabled && /(checkbox|radio)/i.test($el.type) ) {
                        // apply checked choice : if true -> set to false, and if false -> set to true                        
                        if ( /checkbox/i.test($el.type) ) {
                            return updateCheckBox($el);
                        } else {
                            return updateRadio($el);
                        }
                    }                    
                }                        
                
                
                // include only these elements for the binding
                if ( 
                    /(button|input)/i.test($el.tagName) && /(submit|checkbox|radio)/i.test($el.type)
                    || /a/i.test($el.tagName) && $el.attributes.getNamedItem('data-gina-form-submit')
                ) {
                    
                    if ( typeof($el.id) == 'undefined' || !$el.getAttribute('id') ) {
                        $el.setAttribute('id', 'click.' + uuid.v4() );
                        $el.id = $el.getAttribute('id')
                    } else {
                        $el.id = $el.getAttribute('id')
                    }
    
                    
                    if (/^click\./.test($el.id) || withRules) {
    
                        var _evt = $el.id;
    
                        if (!_evt) return false;
    
                        if ( !/^click\./.test(_evt) ) {
                            _evt = $el.id
                        }
    
                        // prevent event to be triggered twice
                        if ( typeof(event.defaultPrevented) != 'undefined' && event.defaultPrevented )
                            return false;
    
                        if (gina.events[_evt]) {
                            cancelEvent(event);
    
                            triggerEvent(gina, $el, _evt, event.detail);
                        }
    
                    }
                }                                

            })
        }
        
        procced();

        
        for (var i = 0, iLen = $inputs.length; i < iLen; ++i) {
            type    = $inputs[i].getAttribute('type');

            if ( typeof($inputs[i].id) == 'undefined' || $inputs[i].id == '' ) {
                $inputs[i].id = type +'-'+ uuid.v4();
                $inputs[i].setAttribute('id', $inputs[i].id)
            }


            // recover default state only on value === true || false || on
            if ( typeof(type) != 'undefined' && type == 'checkbox' && /^(true|false|on)$/i.test($inputs[i].value) || typeof(type) != 'undefined' && type == 'checkbox' && !$inputs[i].getAttribute('value') ) {

                if ( !/^(true|false|on)$/i.test($inputs[i].value)  ) {

                    if ( !$inputs[i].checked || $inputs[i].checked == 'null' || $inputs[i].checked == 'false' || $inputs[i].checked == '' ) {
                        $inputs[i].value = false;
                        $inputs[i].setAttribute('value', false)
                    } else {
                        $inputs[i].value = true;
                        $inputs[i].setAttribute('value', true)
                    }
                }


                evt = $inputs[i].id;

                procced = function ($el, evt) {

                    // recover default state only on value === true || false
                    addListener(gina, $el, evt, function(event) {
                        
                        var value = event.target.value || event.target.getAttribute('value') || event.target.getAttribute('data-value');
                        
                        if ( /^(true|false|on)$/i.test(value) ) {
                            cancelEvent(event);
                            updateCheckBox(event.target);
                        }
                    });

                    // default state recovery
                    var value = $el.value || $el.getAttribute('value') || $el.getAttribute('data-value');
                    if ( typeof(value) != 'undefined' && /^(true|on|false)$/.test(value) ) {
                        $el.checked = /true|on/.test(value) ? true : false;
                        updateCheckBox($el);
                    }    
                }

                if ( typeof(gina.events[evt]) != 'undefined' && gina.events[evt] == $inputs[i].id ) {
                    removeListener(gina, $inputs[i], evt);
                    procced($inputs[i], evt)

                } else {
                    procced($inputs[i], evt)
                }

            } else if ( typeof(type) != 'undefined' && type == 'radio' ) {

                evt = $inputs[i].id;

                procced = function ($el, evt) {
                    addListener(gina, $el, evt, function(event) {

                        cancelEvent(event);
                        updateRadio(event.target);
                    });


                    updateRadio($el, true);
                }

                if ( typeof(gina.events[evt]) != 'undefined' && gina.events[evt] == $inputs[i].id ) {
                    removeListener(gina, $inputs[i], evt);
                    procced(event.target, evt)

                } else {
                    procced($inputs[i], evt)
                }
            }
        }


        if (withRules) {

            evt = 'validate.' + _id;
            procced = function () {

                // attach form event
                addListener(gina, $target, evt, function(event) {
                    cancelEvent(event);


                    var result = event['detail'] || $form.eventData.validation;
                    
                    handleErrorsDisplay(event['target'], result['errors'], result['data']);

                    var _id = event.target.getAttribute('id');

                    if ( result['isValid']() ) { // send if valid
                        // now sending to server
                        if (instance.$forms[_id]) {
                            instance.$forms[_id].send(result['data']);
                        } else if ($form) { // just in case the form is being destroyed
                            $form.send(result['data']);
                        }
                    }
                })
            }

            if ( typeof(gina.events[evt]) != 'undefined' && gina.events[evt] == 'validate.' + _id ) {
                removeListener(gina, $form, evt, procced)
            } else {
                procced()
            }


            var proccedToSubmit = function (evt, $submit) {
                // console.log('placing submit ', evt, $submit);
                // attach submit events
                addListener(gina, $submit, evt, function(event) {
                    // start validation
                    cancelEvent(event);

                    // getting fields & values
                    var $fields     = {}
                        , fields    = { '_length': 0 }
                        , id        = $target.getAttribute('id')
                        , rules     = ( typeof(gina.validator.$forms[id]) != 'undefined' ) ? gina.validator.$forms[id].rules : null
                        , name      = null
                        , value     = 0
                        , type      = null
                        , index     = { checkbox: 0, radio: 0 };


                    for (var i = 0, len = $target.length; i<len; ++i) {

                        name    = $target[i].getAttribute('name');

                        if (!name) continue;

                        // TODO - add switch cases against tagName (checkbox/radio)
                        if ( typeof($target[i].type) != 'undefined' && $target[i].type == 'radio' || typeof($target[i].type) != 'undefined' && $target[i].type == 'checkbox' ) {
                            
                            
                            
                            if ( 
                                $target[i].checked 
                                || typeof (rules[name]) == 'undefined'
                                    && $target[i].value != 'undefined'
                                    && /^(true|false)$/.test($target[i].value)
                                || !$target[i].checked
                                    && typeof (rules[name]) != 'undefined'
                                    && typeof (rules[name].isBoolean) != 'undefined' && /^true$/.test(rules[name].isBoolean)
                                    && typeof (rules[name].isRequired) != 'undefined' && /^true$/.test(rules[name].isRequired)
                            ) {
                                // if is boolean
                                if ( /^(true|false)$/.test($target[i].value) ) {
                                    
                                    if ( typeof(rules[name]) == 'undefined' ) {
                                        rules[name] = { isBoolean: true };
                                    } else if ( typeof(rules[name]) != 'undefined' && typeof(rules[name].isBoolean) == 'undefined' ) {
                                        rules[name].isBoolean = true;
                                    }

                                    if ($target[i].type == 'radio') {
                                        if ( typeof(rules[name]) == 'undefined' )
                                            throw new Error('rule '+ name +' is not defined');
                                            
                                        if (/^true$/.test(rules[name].isBoolean) && $target[i].checked ) {
                                            fields[name] = (/^true$/.test($target[i].value)) ? true : false;
                                        }
                                    } else {
                                        fields[name] = $target[i].value = (/^true$/.test($target[i].value)) ? true : false;
                                    }

                                } else {
                                    fields[name] = $target[i].value
                                }
                            }  else if ( // force validator to pass `false` if boolean is required explicitly
                                rules
                                && typeof(rules[name]) != 'undefined'
                                && typeof(rules[name].isBoolean) != 'undefined'
                                && typeof(rules[name].isRequired) != 'undefined'
                                && !/^(true|false)$/.test($target[i].value)

                            ) {
                                fields[name] = false;
                            }

                        } else {
                            fields[name] = $target[i].value;
                        }

                        if ( typeof($fields[name]) == 'undefined' ) {
                            $fields[name] = $target[i];
                            // reset filed error data attributes
                            $fields[name].setAttribute('data-gina-form-errors', '');
                        }
                        
                        ++fields['_length']
                    }

                    if ( fields['_length'] == 0 ) { // nothing to validate
                        delete fields['_length'];
                        var result = {
                            'errors'    : [],
                            'isValid'   : function() { return true },
                            'data'      : formatData(fields)
                        };

                        triggerEvent(gina, $target, 'validate.' + _id, result)

                    } else {
                        // update rule in case the current event is triggered outside the main sequence
                        // e.g.: form `id` attribute rewritten on the fly
                        _id = $target.getAttribute('id');
                        var customRule = $target.getAttribute('data-gina-form-rule');

                        if ( customRule ) { // 'data-gina-form-rule'
                            rule = gina.validator.rules[ customRule.replace(/\-/g, '.') ];
                        } else {
                            rule = gina.validator.$forms[ _id ].rules;
                        }

                        validate($target, fields, $fields, rule, function onValidation(result){
                            triggerEvent(gina, $target, 'validate.' + _id, result)
                        })
                    }
                });
            }


            // binding submit button
            var $submit         = null
                , $buttons      = []
                , $buttonsTMP   = []
                , linkId        = null 
                , buttonId      = null
            ;
            $buttonsTMP = $target.getElementsByTagName('button');
            if ( $buttonsTMP.length > 0 ) {
                for(var b = 0, len = $buttonsTMP.length; b < len; ++b) {
                    if ($buttonsTMP[b].type == 'submit')
                        $buttons.push($buttonsTMP[b])
                }
            }

            // binding links
            $buttonsTMP = $target.getElementsByTagName('a');            
            if ( $buttonsTMP.length > 0 ) {
                for(var b = 0, len = $buttonsTMP.length; b < len; ++b) {
                    if ( $buttonsTMP[b].attributes.getNamedItem('data-gina-form-submit') ) {
                        $buttons.push($buttonsTMP[b])
                    } else if ( 
                        !$buttonsTMP[b].getAttribute('id') 
                        && !/gina\-popin/.test($buttonsTMP[b].className) 
                        && !gina.popinIsBinded
                        && !/gina\-link/.test($buttonsTMP[b].className) 
                    ) { // will not be binded but will receive an id if not existing
                        linkId = 'link.'+ uuid.v4();
                        $buttonsTMP[b].id = linkId;
                    }
                }
            }


            var onclickAttribute = null, isSubmitType = false;
            for (var b=0, len=$buttons.length; b<len; ++b) {

                $submit = $buttons[b];

                if ($submit.tagName == 'A') { // without this test, XHR callback is ignored
                    //console.log('a#$buttons ', $buttonsTMP[b]);
                    onclickAttribute    = $submit.getAttribute('onclick');
                    isSubmitType        = $submit.getAttribute('data-gina-form-submit');

                    if ( !onclickAttribute && !isSubmitType) {
                        $submit.setAttribute('onclick', 'return false;')
                    } else if ( !/return false/ && !isSubmitType) {
                        if ( /\;$/.test(onclickAttribute) ) {
                            onclickAttribute += 'return false;'
                        } else {
                            onclickAttribute += '; return false;'
                        }
                    }
                }

                if (!$submit['id']) {

                    evt = 'click.'+ uuid.v4();
                    $submit['id'] = evt;
                    $submit.setAttribute( 'id', evt);

                } else {
                    evt = $submit['id'];
                }


                if ( typeof(gina.events[evt]) == 'undefined' || gina.events[evt] != $submit.id ) {
                    proccedToSubmit(evt, $submit)
                }

            }
        }



        evt = 'submit';

        // submit proxy
        addListener(gina, $target, evt, function(e) {

            var $target     = e.target
                , id        = $target.getAttribute('id')
                , isBinded  = instance.$forms[id].binded
            ;

            // prevent event to be triggered twice
            if ( typeof(e.defaultPrevented) != 'undefined' && e.defaultPrevented )
                return false;

            if (withRules || isBinded) {
                cancelEvent(e);
            }


            // just collect data over forms
            // getting fields & values
            var $fields     = {}
                , fields    = { '_length': 0 }
                , id        = $target.getAttribute('id')
                , rules     = ( typeof(gina.validator.$forms[id]) != 'undefined' ) ? gina.validator.$forms[id].rules : null
                , name      = null
                , value     = 0
                , type      = null
                , index     = { checkbox: 0, radio: 0 };


            for (var i = 0, len = $target.length; i<len; ++i) {
                name = $target[i].getAttribute('name');

                if (!name) continue;

                // checkbox or radio
                if ( typeof($target[i].type) != 'undefined' && $target[i].type == 'radio' || typeof($target[i].type) != 'undefined' && $target[i].type == 'checkbox' ) {

                    if ( $target[i].checked ) {
                        // if is boolean
                        if ( /^(true|false)$/.test($target[i].value) ) {
                            fields[name] = $target[i].value = (/^true$/.test($target[i].value)) ? true : false
                        } else {
                            fields[name] = $target[i].value
                        }

                    }  else if ( // force validator to pass `false` if boolean is required explicitly
                    rules
                    && typeof(rules[name]) != 'undefined'
                    && typeof (rules[name].isBoolean) != 'undefined' && $target[i].type == 'checkbox'
                    //&& typeof(rules[name].isRequired) != 'undefined'
                    && !/^(true|false)$/.test($target[i].value)
                    ) {
                        fields[name] = false;
                    }

                } else {
                    fields[name]    = $target[i].value;
                }



                $fields[name] = $target[i];
                // reset filed error data attributes
                $fields[name].setAttribute('data-gina-form-errors', '');

                ++fields['_length']
            }


            if ( fields['_length'] == 0 ) { // nothing to validate

                delete fields['_length'];
                var result = {
                    'errors'    : [],
                    'isValid'   : function() { return true },
                    'data'      : formatData(fields)
                };

                if ( typeof(gina.events['submit.' + id]) != 'undefined' ) { // if `on('submit', cb)` is binded
                    triggerEvent(gina, $target, 'submit.' + id, result);
                } else {
                    triggerEvent(gina, $target, 'validate.' + id, result);
                }

            } else {
                // update rule in case the current event is triggered outside the main sequence
                // e.g.: form `id` attribute rewritten on the fly

                var customRule = $target.getAttribute('data-gina-form-rule');

                if ( customRule ) { // 'data-gina-form-rule'
                    rule = gina.validator.rules[ customRule.replace(/\-/g, '.') ];
                } else {
                    rule = gina.validator.$forms[ id ].rules;
                }

                validate($target, fields, $fields, rule, function onValidation(result){
                    if ( typeof(gina.events['submit.' + id]) != 'undefined' ) { // if `on('submit', cb)` is binded
                        triggerEvent(gina, $target, 'submit.' + id, result);
                    } else {
                        triggerEvent(gina, $target, 'validate.' + id, result);
                    }
                })
            }
        });

        instance.$forms[_id]['binded']  = true;
    }

    var validate = function($form, fields, $fields, rules, cb) {

        delete fields['_length']; //cleaning

        var id                  = null
            , data              = null
            , hasBeenValidated  = false
            , subLevelRules     = 0
            , rootFieldsCount   = fields.count()
        ;

        if (isGFFCtx) {
            id = $form.getAttribute('id') || $form.id;
            instance.$forms[id].fields = fields;
        }
        //console.log(fields, $fields);

        var d = new FormValidator(fields, $fields), args = null;
        var fieldErrorsAttributes = {};
        var re = null, flags = null;

        var forEachField = function($form, fields, $fields, rules, cb, i) {
            
            
            
            var hasCase = false, isInCase = null, conditions = null;
            var caseValue = null, caseType = null;
            var localRules = null;

            //console.log('parsing ', fields, $fields, rules);
            if ( typeof(rules) != 'undefined' ) { // means that no rule is set or found
                for (var field in fields) {
                    
                    // $fields[field].tagName getAttribute('type')
                    //if ( $fields[field].tagName.toLowerCase() == 'input' && /(checkbox)/.test( $fields[field].getAttribute('type') ) && !$fields[field].checked ) {
                    if ($fields[field].tagName.toLowerCase() == 'input' && /(checkbox)/.test($fields[field].getAttribute('type')) && !$fields[field].checked ) {
                        //if ( typeof(rules[field]) == 'undefined' && !$fields[field].checked || typeof(rules[field]) != 'undefined' && typeof(rules[field]['isRequired']) != 'undefined' && /(false)/.test(rules[field]['isRequired']) )
                            continue;
                    }

                    hasCase = ( typeof(rules['_case_' + field]) != 'undefined' ) ? true : false;
                    isInCase = false;
                    for (var c in rules) {
                        if (!/^\_case\_/.test(c) ) continue;
                        if ( typeof(rules[c].conditions) == 'undefined' ) continue;
                        if ( typeof(rules[c].conditions[0].rules) == 'undefined' ) continue;
                        
                        //if ( typeof(rules[c].conditions[0].rules[field]) != 'undefined' ) {
                        if ( typeof(rules[c].conditions[0].rules[field]) != 'undefined' && typeof(rules[field]) == 'undefined' ) {
                            isInCase = true;
                            break;
                        }                            
                    }
                    
                    if (isInCase) continue;

                    if (!hasCase) {
                        if (typeof (rules[field]) == 'undefined') continue;


                        // check each field against rule
                        for (var rule in rules[field]) {
                            // check for rule params
                            try {

                                if (Array.isArray(rules[field][rule])) { // has args
                                    //convert array to arguments
                                    args = JSON.parse(JSON.stringify(rules[field][rule]));
                                    if ( /\$[\w\[\]]*/.test(args[0]) ) {
                                        var foundVariables = args[0].match(/\$[\w\[\]]*/g);
                                        for (var v = 0, vLen = foundVariables.length; v < vLen; ++v) {
                                            args[0] = args[0].replace( foundVariables[v], d[foundVariables[v].replace('$', '')].value )
                                        }
                                    }
                                    d[field][rule].apply(d[field], args);
                                    // .match(/\$[\w\[\]]*/g)
                                } else {
                                    d[field][rule](rules[field][rule]);
                                }

                                delete fields[field];

                            } catch (err) {
                                if (rule == 'conditions') {
                                    throw new Error('[ ginaFormValidator ] could not evaluate `' + field + '->' + rule + '()` where `conditions` must be a `collection` (Array)\nStack:\n' + (err.stack | err.message))
                                } else {
                                    throw new Error('[ ginaFormValidator ] could not evaluate `' + field + '->' + rule + '()`\nStack:\n' + (err.stack | err.message))
                                }
                            }

                        }
                    } else {
                        ++i; // add sub level
                        conditions = rules['_case_' + field]['conditions'];

                        if ( !conditions ) {
                            throw new Error('[ ginaFormValidator ] case `_case_'+field+'` found without `condition(s)` !');
                        }

                        for (var c = 0, cLen = conditions.length; c<cLen; ++c) {

                            caseValue = fields[field];

                            if (isGFFCtx) {
                                if (fields[field] == "true")
                                    caseValue = true;
                                else if (fields[field] == "false")
                                    caseValue = false;
                            }

                            //console.log(caseValue +' VS '+ conditions[c]['case'], "->", (caseValue == conditions[c]['case'] || Array.isArray(conditions[c]['case']) && conditions[c]['case'].indexOf(caseValue) > -1) );
                            if ( conditions[c]['case'] === caseValue || Array.isArray(conditions[c]['case']) && conditions[c]['case'].indexOf(caseValue) > -1 || /^\//.test(conditions[c]['case']) ) {

                                //console.log('[fields ] ' + JSON.stringify(fields, null, 4));
                                localRules = {};
                                
                                for (var f in conditions[c]['rules']) {
                                    //console.log('F: ', f, '\nrule: '+ JSON.stringify(conditions[c]['rules'][f], null, 2));
                                    if ( /^\//.test(f) ) { // RegExp found

                                        re      = f.match(/\/(.*)\//).pop();
                                        flags   = f.replace('/'+ re +'/', '');
                                        re      = new RegExp(re, flags);

                                        for (var localField in $fields) {
                                            if ( re.test(localField) ) {
                                                if ( /^\//.test(conditions[c]['case']) ) {
                                                    re      = conditions[c]['case'].match(/\/(.*)\//).pop();
                                                    flags   = conditions[c]['case'].replace('/'+ re +'/', '');
                                                    re      = new RegExp(re, flags);

                                                    if ( re.test(caseValue) ) {
                                                        localRules[localField] = conditions[c]['rules'][f]
                                                    }

                                                } else {
                                                    localRules[localField] = conditions[c]['rules'][f]
                                                }
                                            }
                                        }

                                    } else {
                                        if ( /^\//.test(conditions[c]['case']) ) {
                                            
                                            re      = conditions[c]['case'].match(/\/(.*)\//).pop();
                                            flags   = conditions[c]['case'].replace('/'+ re +'/', '');
                                            re      = new RegExp(re, flags);

                                            if ( re.test(caseValue) ) {
                                                localRules[f] = conditions[c]['rules'][f]
                                            }

                                        } else {
                                            localRules[f] = conditions[c]['rules'][f]
                                        }
                                    }
                                }
                                
                                ++subLevelRules; // add sub level
                                if (isGFFCtx)
                                    forEachField($form, fields, $fields, localRules, cb, i);
                                else
                                    return forEachField($form, fields, $fields, localRules, cb, i);
                            }
                            
                        }
                        --i;
                    }

                    // if ( typeof(rules[field]) == 'undefined' ) continue;


                    // // check each field against rule
                    // for (var rule in rules[field]) {
                    //     // check for rule params
                    //     try {

                    //         if ( Array.isArray(rules[field][rule]) ) { // has args
                    //             //convert array to arguments
                    //             args = rules[field][rule];
                    //             d[field][rule].apply(d[field], args);
                    //         } else {
                    //             d[field][rule](rules[field][rule]);
                    //         }

                    //     } catch (err) {
                    //         if (rule == 'conditions') {
                    //             throw new Error('[ ginaFormValidator ] could not evaluate `'+field+'->'+rule+'()` where `conditions` must be a `collection` (Array)\nStack:\n'+ (err.stack|err.message))
                    //         } else {
                    //             throw new Error('[ ginaFormValidator ] could not evaluate `'+field+'->'+rule+'()`\nStack:\n'+ (err.stack|err.message))
                    //         }
                    //     }

                    // }
                } // EO for
            } 
            
            --subLevelRules;

            if (i <= 0 && subLevelRules < 0) {

                var errors = d['getErrors']();

                // adding data attribute to handle display refresh
                for (var field in errors) {
                    for (rule in errors[field]) {
                        if (!fieldErrorsAttributes[field]) {
                            fieldErrorsAttributes[field] = ''
                        }

                        if (fieldErrorsAttributes[field].indexOf(rule) < 0)
                            fieldErrorsAttributes[field] += rule +' ';
                    }

                    if (isGFFCtx)
                        $fields[field].setAttribute('data-gina-form-errors', fieldErrorsAttributes[field].substr(0, fieldErrorsAttributes[field].length-1))
                }

                //calling back
                try {
                    data = formatData( d['toData']() );

                    if ( isGFFCtx && typeof(window.ginaToolbar) == 'object' ) {
                        // update toolbar
                        if (!gina.forms.sent)
                            gina.forms.sent = {};

                        //gina.forms.sent = data;
                        //gina.forms.id   = id;

                        var objCallback = {
                            id      : id,
                            sent    : data
                        };

                        window.ginaToolbar.update('forms', objCallback);
                    }
                } catch (err) {
                    throw err
                }

                if (!hasBeenValidated) {

                    hasBeenValidated = true;

                    if ( typeof(cb) != 'undefined' && typeof(cb) === 'function' ) {

                        cb({
                            'isValid'   : d['isValid'],
                            'errors'    : errors,
                            'data'      : data
                        })

                    } else {

                        return {
                            'isValid'   : d['isValid'],
                            'errors'    : errors,
                            'data'      : data
                        }
                    }
                }
            }
        }

        // 0 is the starting level
        if (isGFFCtx)
            forEachField($form, fields, $fields, rules, cb, 0);
        else
            return forEachField($form, fields, $fields, rules, cb, 0);
    }

    var setupInstanceProto = function() {

        instance.setOptions             = setOptions;
        instance.getFormById            = getFormById;
        instance.validateFormById       = validateFormById;
        instance.target                 = document;
        instance.validateFormById       = validateFormById;
        instance.resetErrorsDisplay     = resetErrorsDisplay;
        instance.resetFields            = resetFields;
        instance.handleErrorsDisplay    = handleErrorsDisplay;
        instance.send                   = send;
    }

    if (isGFFCtx) {
        return init(rules)
    } else {
        return backendInit(rules, data, formId)
    }

};

if ( ( typeof(module) !== 'undefined' ) && module.exports ) {
    // Publish as node.js module
    module.exports  = ValidatorPlugin
} else if ( typeof(define) === 'function' && define.amd) {
    // Publish as AMD module
    define('gina/validator', ['utils/events', 'utils/dom', 'utils/form-validator'], function(){ return ValidatorPlugin })
};
define('gina/toolbar', ['require', 'jquery', 'vendor/uuid'/**, 'utils/merge'*/, 'utils/collection', 'utils/routing', 'gina/storage', 'gina/validator' ], function (require) {

    var $           = require('jquery');
    $.noConflict();
    //var merge       = require('utils/merge');
    var routing     = require('utils/routing');
    var Collection  = require('utils/collection');
    var Storage     = require('gina/storage');
    //var Validator   = require('gina/validator');

    /**
     * Toolbar plugin
     * 
     * TODO - search using `datatables` plugin (https://stackoverflow.com/questions/10400033/is-there-a-jquery-plugin-like-datatables-for-a-ul)
     */
    function Toolbar() {

        //console.log('Toolbar jquery is ', $.fn.jquery);

        var self = {
            version         : '1.0.2',
            foldingPaths    : {},
            foldingClass    : null,
            isUnfolded      : null,
            isXHR           : false,
            isValidator     : false
        };

        var bucket      = new Storage({bucket: 'gina'}) // <Bucket>
            , plugins   = bucket.Collection('plugin') // <Collection>
            //, validator = new Validator() // <Validator>
        ;

        var $toolbar             = null
            , settings           = null
            , isCollapsed        = false
            , $tabs              = null
            , $logo              = null
            , $panelsContainer   = null
            , $panels            = null
            , $currentPanel      = null
            , panelId            = ''
            , $verticalPos       = null
            , $horizontalPos     = null
            , $toolbarPos        = null
            , position           = ''
            , $toolbarWidth      = null
            , width              = 0
            , $toolbarHeight     = null
            , toolbarHeight      = 0
            , contentHeight      = 0
            , keynum             = ''
            , lastPressedKey     = {}
            , coockie            = null
            , $json              = null
            , $ginaJson          = null
            , $jsonRAW           = null
            , originalData       = null
            , jsonObject         = null
            , lastJsonObjectState = null
            , ginaJsonObject     = null
            , forms              = null
            , formsIgnored       = '.gina-toolbar-options, .gina-toolbar-content'
            , $htmlConfigurationEnvironment = null
            , $htmlData          = null
            , $htmlView          = null
            , $htmlForms         = null
            , $codeFoldingToggle = null
            , codeFolding        = true
            , timeoutId          = null
            , $copyCache         = null
            , copyValue          = null
            ;

        var init = function () {
            // Get elements
            $toolbar           = $('#gina-toolbar');
            if (!$toolbar.length) return false;

            $tabs              = $toolbar.find('.gina-toolbar-tab > a');
            $logo              = $('#gina-toolbar-toggle');
            $panelsContainer   = $('#gina-toolbar-panels');
            $panels            = $panelsContainer.find('.gina-toolbar-panel');
            $verticalPos       = $('#gina-toolbar-vposition');
            $horizontalPos     = $('#gina-toolbar-hposition');
            $toolbarPos        = $verticalPos.add($horizontalPos);
            $toolbarWidth      = $('#gina-toolbar-width');
            $toolbarHeight     = $toolbar.find('.gina-toolbar-main');
            $json              = $('#gina-toolbar-json');
            $ginaJson          = $('#gina-toolbar-gina-json');
            $jsonRAW           = $('#gina-toolbar-toggle-code-raw');
            $forms             = $('form:not('+ formsIgnored +')');
            $htmlData          = $('#gina-toolbar-data-html');
            $htmlView          = $('#gina-toolbar-view-html');
            $htmlForms         = $('#gina-toolbar-forms-html');
            $htmlConfigurationEnvironment = $('#gina-toolbar-configuration-environment-html')
            $codeFoldingToggle = $('#gina-toolbar-code-toggle');

            // Append textarea for copy/paste then select it
            $toolbar.prepend('<textarea class="gina-toolbar-copy"></textarea>');
            $copyCache         = $toolbar.find('.gina-toolbar-copy');

            // Get toolbar settings
            settings = plugins.findOne({_name: 'toolbar'});

            if ( !settings ) {
                // default settings
                settings = {
                    _name           : 'toolbar',
                    _version        : self.version,
                    _description    : 'Toolbar settings',
                    _licence        : 'MIT',
                    _author         : [
                        {name: 'Fabrice Delaneau', company: 'Freelancer'},
                        {name: 'Martin-Luther Etouman', company: 'Rhinostone'}
                    ],
                    position        : 'top-right',
                    width           : '30',
                    panelId         : '#gina-toolbar-data',
                    isCollapsed     : true,
                    isUnfolded      : []
                };
                // saving default settings
                plugins.insert(settings);
                settings = plugins.findOne({_name: 'toolbar'});

            }

            // in case of local storage schema update;
            if (settings._version != self.version) {
                checkSchemaUpdate();
            }

            position    = settings.position;
            width       = settings.width;
            panelId     = settings.panelId;
            isCollapsed = settings.isCollapsed;

            $toolbar.removeClass('gina-toolbar-hidden');
            handle() // Bind behaviors
        };


        var checkSchemaUpdate = function () {
            // Run every update from your current version up to the head

            if (settings._version < '1.0.1') {
                if (!settings.isUnfolded ) {
                    settings.isUnfolded = [];
                }
                if (settings.codeFolding != undefined) {
                    delete settings.codeFolding;
                }
            }

            if ( typeof(settings.isUnfolded) != 'undefined' && !Array.isArray(settings.isUnfolded) ) {
                settings.isUnfolded = [];
            }

            // update version number
            settings._version = self.version;

            // save all changes
            settings.save(true);
        }

        /**
         * loadData
         *
         * @param {object} [section]
         * @param {object} [data]
         * @param {object} [ginaData]
         *
         * */
        var loadData = function (section, data, ginaData) {

            var $currentForms = null;

            try {
                var txt = $json.text();
                if (txt == '' || txt == 'null' ) {
                    $json.text('Empty')
                } else {
                    jsonObject = JSON.parse(txt);
                    ginaJsonObject = JSON.parse($ginaJson.text());
                    $json.text('');

                    // backing up document data for restore action
                    if (!originalData) {
                        originalData = {
                            jsonObject      : JSON.parse(JSON.stringify(jsonObject)),
                            ginaJsonObject  : JSON.parse(JSON.stringify(ginaJsonObject))
                        };
                        lastJsonObjectState = {}; // jsonObject.data
                        
                    }
                }

            } catch (err) {
                
                var sectionStr = ( section ) ? ' [ '+ section + ' ] ' : ' ';                                    
                $json.text('Could not load'+ sectionStr +'json\n' + (err.stack||err.message||err));
            }

            if (jsonObject) {

                if (data && !ginaData) {
                    if ( !jsonObject[section] )
                        jsonObject[section] = {};

                    jsonObject[section] = ginaJsonObject[section] = data;

                } else if ( section == 'data-xhr' && !data && jsonObject['data-xhr'] ) {
                    // reset xhr
                    delete jsonObject['data-xhr'];
                } else if (ginaData) {
                    jsonObject      = data;
                    ginaJsonObject  = ginaData;
                }


                // Make folding paths
                makeFoldingPaths(jsonObject, '');

                // Create DOM from JSON
                // -> Configuration::environment
                // filtering before
                delete jsonObject.environment.routing;
                delete ginaJsonObject.environment.routing;
                delete jsonObject.environment.forms;
                delete ginaJsonObject.environment.forms;
                $htmlConfigurationEnvironment.html(parseObject(jsonObject.environment, ginaJsonObject.environment));


                var userObject   = { data: jsonObject.data, view: jsonObject.view, forms: jsonObject.forms }
                    , ginaObject  = { data: ginaJsonObject.data, view: ginaJsonObject.view, forms: ginaJsonObject.forms } ;


                // xhr mode
                self.initiatedXhrFoldingState = false;
                // validator mode
                self.isValidator = false;

                var isXHR = null, isXHRViewData = false;

                if ( /^(view-xhr)$/.test(section) ) {

                    isXHR = true;

                    userObject.view = jsonObject[section];
                    ginaObject.view = ginaJsonObject[section];

                    userObject.data = jsonObject['data-xhr'];
                    ginaObject.data = ginaJsonObject['data-xhr'];
                }

                if ( !section || /^(data)$/.test(section) ) {
                    

                    // -> Data
                    $htmlData.html('<ul class="gina-toolbar-code">' + parseObject(userObject.data, ginaObject.data, null, isXHR) +'</ul>');

                    // -> View
                    // init view
                    var htmlProp =  '<div id="gina-toolbar-view-html-properties" class="gina-toolbar-section">\n' +
                                    '    <h2 class="gina-toolbar-section-title">properties</h2>\n' +
                                    '    <ul class="gina-toolbar-properties"></ul>\n' +
                                    '</div>';

                    $htmlView.html(htmlProp);
                    
                    $htmlView.html( parseView(userObject.view, ginaObject.view, null, isXHR, $htmlView) );

                    // -> Forms
                    $currentForms = $forms;                    
                    $htmlForms.html('');
                    $htmlForms.html( parseForms(userObject.forms, ginaObject.forms, $htmlForms, 0, $currentForms, $currentForms.length, isXHR) );
                    // Form binding
                    $htmlForms.find('div.gina-toolbar-section > h2').off('click').on('click', function(event) {
                        event.preventDefault();

                        $(this)
                            .parent()
                            .find('ul').first()
                            .slideToggle();
                    });

                    //$htmlForms.html( parseView(jsonObject.forms, ginaJsonObject.forms, null, $htmlForms) );
                } else if ( /^(data-xhr|view-xhr)$/.test(section) ) {
                    
                    // reset case
                    if ( typeof(jsonObject[section]) == 'undefined' || !jsonObject[section] || jsonObject[section] == 'null' ) {
                        return false;
                    }

                    // -> XHR Data
                    isXHR = true;
                    isXHRViewData = (typeof (jsonObject[section].isXHRViewData) != 'undefined') ? true : isXHRViewData;
                        
                    
                    // update data section without erasing old data
                    if (!isXHRViewData && !/^(view-xhr)$/.test(section)) {
                        
                        // also update original data to handle restore action
                        if ( typeof (jsonObject['el-xhr']) != 'undefined' ) {
                            lastJsonObjectState.data = JSON.parse(JSON.stringify(jsonObject[section]));
                        }

                        
                        
                    }

                    // -> isXHRViewData (from popin) : cleanup
                    if (isXHRViewData) {
                        delete jsonObject[section].isXHRViewData;
                    }

                    if ( /^(data-xhr)$/.test(section) ) {
                        $htmlData.html('<ul class="gina-toolbar-code">' + parseObject(jsonObject[section], ginaJsonObject[section], null, isXHR) +'</ul>');
                    } else if ( /^(view-xhr)$/.test(section) ) {
                        //$htmlView.html( parseView(userObject.view, ginaObject.view, null, isXHR, $htmlView) );
                        // -> View
                        // init view
                        var htmlProp =  '<div id="gina-toolbar-view-html-properties" class="gina-toolbar-section">\n' +
                                        '    <h2 class="gina-toolbar-section-title">properties</h2>\n' +
                                        '    <ul class="gina-toolbar-properties"></ul>\n' +
                                        '</div>';

                        $htmlView.html(htmlProp);
                        $htmlView.html( parseView(jsonObject[section], ginaJsonObject[section], null, isXHR, $htmlView) );
                    }
                    
                } else if ( /^(el-xhr)$/.test(section) ) {
                    // -> XHR Forms
                    isXHR = true;                    
                    $currentForms = $('#' + data).find('form:not(' + formsIgnored + ')');
                    $htmlForms.html('');
                    $htmlForms.html( parseForms(userObject.forms, ginaObject.forms, $htmlForms, 0, $currentForms, $currentForms.length, isXHR ) );
                    // Form binding
                    $htmlForms.find('div.gina-toolbar-section > h2').off('click').on('click', function(event) {
                        event.preventDefault();

                        $(this)
                            .parent()
                            .find('ul').first()
                            .slideToggle();
                    });
                } else if ( /^(forms)$/.test(section) ) {
                    isXHR = true;
                    self.isValidator = true;
                    // form errors
                    if ( typeof(data.errors) != 'undefined' ) {
                        updateForm(data.id, 'errors', data.errors, isXHR)
                    }

                    // form data sent
                    if ( typeof(data.sent) != 'undefined' ) {
                        updateForm(data.id, 'sent', data.sent, isXHR)
                    }
                }


                // Manage folding state
                settings.currentFile = jsonObject.file;
                if (!settings.currentFile) {
                    // Init currentFile if none exists
                    settings.currentFile = jsonObject.file;
                }

                if (jsonObject.file == settings.currentFile) {
                    // If current page is the same as the previous page, unfold code as neede
                    $(document).ready(function () {
                        
                        if (self.isValidator ) {
                            self.isXHR = true;
                            if (settings.isUnfolded.length > 0 && !self.initiatedXhrFoldingState) {
                                self.initiatedXhrFoldingState = true;
                                setTimeout(function () {
                                    if (settings.isUnfolded.length > 0)
                                        initFoldingState(settings.isUnfolded, settings.isUnfolded.length, 0);
                                }, 200)
                            }
                        } else {
                            if (!isXHR) {
                                self.isXHR = false;
                                setTimeout(function () {
                                    if (settings.isUnfolded.length > 0)
                                        initFoldingState(settings.isUnfolded, settings.isUnfolded.length, 0);
                                }, 200)
                            } else {
                                self.isXHR = true;
                                if (settings.isUnfolded.length > 0 && !self.initiatedXhrFoldingState) {
                                    self.initiatedXhrFoldingState = true;
                                    initFoldingState(settings.isUnfolded, settings.isUnfolded.length, 0);
                                }
                            }
                        }
                    })
                }
            }            
        }


        var initFoldingState = function (unfolded, len, i) {

            if (i == len) return false;

            var key = unfolded[i];
            var $kel = null;

            if ( self.isXHR && /^xhr-/.test(key) ) {
                key = key.replace(/^xhr-/, '');
                $kel = $('.gina-toolbar-xhr-folding-state-'+ key);
            } else {
                $kel = $('.gina-toolbar-folding-state-' + key);
            }

            toggleCodeFolding( $kel, function onCodeToggled() {
                i = i + 1;
                initFoldingState(unfolded, len, i)
            });
        }

        var handle = function () {


            // Add folding behavior
            $htmlData
                .add($htmlView).off('click', 'a').on('click', 'a', function(event) {
                    event.preventDefault();

                    toggleCodeFolding( $(this), null, true )
                })
                .add($htmlForms).off('click', 'a').on('click', 'a', function(event) {
                    event.preventDefault();

                    toggleCodeFolding( $(this), null, true )
                });

            // Expand/collapse all code
            $codeFoldingToggle.off('click').on('click', function(event) {
                event.preventDefault();

                toggleCodeFolding('all', null, true)
            });

            // Add value to the clipboard
            $htmlData.add($htmlView, $htmlForms).off('click', '.gina-toolbar-value').on('click', '.gina-toolbar-value', function(event) {
                event.preventDefault();
                try {
                    copyValue = $(this).text();
                    $copyCache.text(copyValue);
                    $copyCache.select();
                    document.execCommand('copy', false, null);
                    $copyCache.blur();
                } catch(err) {
                    alert('Please press Ctrl/Cmd+C to copy the value');
                    // throw err;
                }

            });

            // display RAW
            $jsonRAW.off('click').on('click', function(event){
                if (jsonObject) {
                    var jsonOut = window.open("", "JSON RAW", "width=400,height=100");
                    //jsonOut.document.write( '<pre>' + JSON.stringify(jsonObject, null, 2) + '</pre>' );
                    jsonOut.document.write( JSON.stringify(jsonObject.data) );
                }
            });

            // Tabs
            $tabs.off('click').on('click', function(event) {
                event.preventDefault();

                // Hide all panels
                $tabs.removeClass('gina-toolbar-active');
                $panels.removeClass('gina-toolbar-active');

                // Show selected tab
                $(this).addClass('gina-toolbar-active');

                // Show selected panel
                panelId = $(this).attr('href');
                $currentPanel = $(panelId).addClass('gina-toolbar-active');

                // Save current active tab to coockie
                settings.panelId = panelId;
                settings.save()
            });

            // Show/hide Toolbar
            $logo.off('click').on('click', function(event) {
                event.preventDefault();

                $toolbar.toggleClass('gina-toolbar-collapsed');

                // Save current visibility state to coockie
                isCollapsed = $toolbar.hasClass('gina-toolbar-collapsed')
                settings.isCollapsed = isCollapsed;
                settings.save()
            });

            // Toolbar position
            $toolbarPos.off('change').on('change', function(event) {
                event.preventDefault();

                // Get selected option value
                var vposition = $verticalPos.val();
                var hposition = $horizontalPos.val();
                position = vposition + '-' + hposition
                changeToolbarPosition(position);

                // Save new position to coockie
                settings.position = position;
                settings.save()
            });

            // Toolbar width
            $toolbarWidth.off('change').on('change', function(event) {
                event.preventDefault();

                // Get selected option value
                width = $toolbarWidth.val();
                changeToolbarWidth(width);

                // Save new width to coockie
                settings.width = width;
                settings.save()
            });

            // Toolbar height
            $(window).off('resize').on('resize', function() {
                changeToolbarHeight();
            });

            // Show/hide toolbar using gg shorcut
            $('body').off('keypress').on('keypress', function onKeypressed(event){                 
            
                if (!/INPUT|TEXTAREA/.test(event.target.tagName )) {
                    if (event.keyCode) {
                        // IE
                        keynum = event.keyCode;
                    } else if (event.which) {
                        // Netscape/Firefox/Opera
                        keynum = event.which;
                    } else {
                        // Chrome/Safari
                        keynum = event.charCode;
                    }
                    var now = new Date();
                    if (
                        typeof lastPressedKey.keynum != "undefined"
                        && lastPressedKey.keynum == keynum
                        && typeof lastPressedKey.pressTime != "undefined"
                        && now.getTime() - lastPressedKey.pressTime < 500
                    ) {
                        switch (keynum) {
                            case 103: //This is the "g" key
                                $toolbar.toggle();
                                // variousTools.setCookie("gina-toolbar[hub]", params.display.hub, 365);
                                break;
                        }
                    }
                    lastPressedKey.pressTime = now.getTime();
                    lastPressedKey.keynum = keynum;
                }
                
            });

                       
            // Updates Toolbar with current values

            // Select the current tab
            $tabs.filter('[href="' + panelId +'"]').trigger('click');

            // Open toolbar if needed
            if (!isCollapsed) {
                $('#gina-toolbar-toggle').trigger('click');
            }

            // Change Toolbar Position and init selects
            changeToolbarPosition(position);

            var positions = position.split('-');
            $verticalPos.val(positions[0]);
            $horizontalPos.val(positions[1]);

            // Change Toolbar Width and init select
            changeToolbarWidth(width);

            $toolbarWidth.val(width);

            // Change Toolbar max-Height;
            changeToolbarHeight();

            // Parse JSON
            var txt = $json.text();
            // dev only - allows HTML 5 mock
            if ( /^\{\{ (.*) \}\}/.test(txt) ) {
                // loading mock
                //var url = document.location.protocol + '//' + document.location.pathname.replace('index.html', '');
                //url + 'mock.json';
                loadJSON(txt, loadData); //parse

            } else {
                loadData()
            }
        }


        var changeToolbarPosition = function (position) {
            $toolbar
                .removeClass('gina-toolbar-top-left gina-toolbar-top-right gina-toolbar-bottom-left gina-toolbar-bottom-right')
                .addClass('gina-toolbar-'+ position);
        }

        var changeToolbarWidth = function (width) {
            $toolbar
                .removeClass('gina-toolbar-auto gina-toolbar-100 gina-toolbar-80 gina-toolbar-60 gina-toolbar-50 gina-toolbar-40 gina-toolbar-30')
                .addClass('gina-toolbar-'+ width);
        }

        var changeToolbarHeight = function () {
            // Use window height - 32px for the header
            toolbarHeight = window.innerHeight - 32;
            $toolbar
                .find('.gina-toolbar-main')
                .css('max-height', toolbarHeight +'px');

            checkContentHeight()
        }

        var checkContentHeight = function () {
            // check toolbar content against window height
            var $currentMain = $currentPanel.find('.gina-toolbar-main');
            var $currentContent = $currentMain.find('.gina-toolbar-content');
            contentHeight = $currentMain.height();
            if (contentHeight == toolbarHeight) {
                $currentContent.addClass('gina-toolbar-content-end')
            } else {
                $currentContent.removeClass('gina-toolbar-content-end')
            }
        }

        var toggleCodeFolding = function ($el, cb, toggledByClick) {
            
            if ( typeof(toggledByClick) == 'undefined' ) {
                var toggledByClick = false
            }

            if ($el != undefined && $el.length && $el != 'all') {

                // Save element folding state
                self.foldingClass = $el.attr('class');
                var hasXhrFlag = false;

                if ( /(gina-toolbar-folding-state-[a-z 0-9_-]+|gina-toolbar-xhr-folding-state-[a-z 0-9_-]+)/i.test(self.foldingClass) ) {
                    
                    if ( /gina-toolbar-folding-state-[a-z0-9_-]+/i.test(self.foldingClass) ) {
                        self.foldingClass = self.foldingClass.match(/gina-toolbar-folding-state-[a-z0-9_-]+/i)[0].replace(/gina-toolbar-folding-state-/, '');
                    } else {
                        hasXhrFlag = true;
                        self.foldingClass = self.foldingClass.match(/gina-toolbar-xhr-folding-state-[a-z0-9_-]+/i)[0].replace(/gina-toolbar-xhr-folding-state-/, 'xhr-');
                    }

                    if ( settings.isUnfolded.indexOf(self.foldingClass) < 0 ) {
                        
                        settings.isUnfolded.push(self.foldingClass);
                        settings.save();
                        
                        if (!$el.hasClass('gina-toolbar-unfolded')) {
                            $el.addClass('gina-toolbar-unfolded');
                            $el.next('ul').slideToggle('fast');
                        }
                        
                    } else {

                        if ( settings.isUnfolded.indexOf(self.foldingClass) > -1 && $el.hasClass('gina-toolbar-unfolded') ) {

                            // remove reference & sub-references
                            var re = new RegExp('^('+ self.foldingClass +')');
                            for (var i = 0, len = settings.isUnfolded.length; i < len; ++i) {
                                if ( re.test(settings.isUnfolded[i]) ) {
                                    if (!self.isValidator && toggledByClick || self.isValidator && hasXhrFlag || toggledByClick ) {
                                        settings.isUnfolded.splice(i, 1);
                                        --i
                                    }
                                }
                            }
                            
                            settings.save(true);
                            
                            if ( settings.isUnfolded.indexOf(self.foldingClass) < 0 ) {
                                $el.removeClass('gina-toolbar-unfolded');
                                $el.next('ul').slideToggle('fast');
                            }
                                

                        } else {
                            $el.addClass('gina-toolbar-unfolded');
                            $el.next('ul').slideToggle('fast');
                        }   
                    }
                }
                
            }

            if (typeof (cb) != 'undefined' && cb != null )
                cb()
        }

        var orderKeys = function(obj) {

            var newObj  = {}
                , k     = null
                , keys  = []
                , i     = 0
                , len   = null
                ;

            for (k in obj) {
                if ( obj.hasOwnProperty(k) ){
                    keys[i] = k;
                    ++i
                }
            }

            len = keys.length;
            keys.sort();

            for (i = 0; i < len; ++i) {
                k = keys[i];
                newObj[k] = obj[k];
            }

            return newObj
        }

        var normalizeFoldingStateName = function(stateSection, stateName) {
            
            var foldingStateName = '', section = null, name = null;

            if ( typeof(stateSection) != 'undefined' && stateSection != '' ) {
                
                section = stateSection;
                if ( typeof(stateSection) == 'string' ) {
                    section = stateSection
                        .replace(/(\]\[|\[)/g, '-')
                        .replace(/\]/, '')
                        .replace(/[^A-Za-z0-9_-]/g, '_')
                }
                
                foldingStateName += section + '-'
            }

            if ( typeof(stateName) != 'undefined' && stateName != '' ) {

                name = stateName;
                if ( typeof(stateName) == 'string' ) {
                    name = stateName
                        .replace(/(\]\[|\[)/g, '-')
                        .replace(/\]/, '')
                }
                
                foldingStateName += name
            } else {
                foldingStateName = foldingStateName.substr(0, foldingStateName.length-1)
            }
            
            return foldingStateName.trim()
        }

        var parseObject = function(obj, ginaObj, elId, elIsXHR, elSection) {

            var html            = '';
            var id              = ( typeof(elId) != 'undefined' && elId != null ) ? elId.replace(/[^A-Za-z0-9_-]/g, '_') : '';
            var section         = ( typeof(elSection) != 'undefined' && elSection != null ) ? elSection : '';
            var isXHR           = ( typeof(elIsXHR) != 'undefined' && elIsXHR != null ) ? '-xhr' : '';
            var count           = '';
            var objType         = '';
            var isEmptyClass    = null;

            obj     = orderKeys(obj);
            ginaObj = orderKeys(ginaObj);

            for (var i in obj) {
                //console.log('i', i);
                //if ( /^(_uuid)$/.test(i) ) continue;

                if ( typeof(obj[i]) == 'object' && !Array.isArray(obj[i]) && obj[i] !== null ) { // parse
                    //id += i + '-';
                    id += '-' + i.replace(/[^A-Za-z0-9_-]/g, '_');
                    isEmptyClass = (obj[i].count() > 0 || ginaObj[i].count() > 0) ? '' : ' is-empty';

                    html += '<li class="gina-toolbar-object">';
                    html +=  '<a href="#" class="gina-toolbar-key gina-toolbar'+ isXHR +'-folding-state-'+ normalizeFoldingStateName( section, i.replace(/[^A-Za-z0-9_-]/g, '_') ) + isEmptyClass +'">'+ i +' <span>{ }</span></a>';
                    html += '<ul class="gina-toolbar-object">' + parseObject(obj[i], ginaObj[i], id, elIsXHR, elSection) +'</ul>';
                    html += '</li>';
                    // clear one level
                    //id = id.substr(0, id.length - i.length - 1);
                    id = id.substr(0, id.length - i.length);
                } else if ( Array.isArray(obj[i]) ) {
                    //id += i + '-';
                    id += '-' + i.replace(/[^A-Za-z0-9_-]/g, '_');
                    isEmptyClass = (obj[i].length > 0 || ginaObj[i].length > 0) ? '' : ' is-empty';

                    html += '<li class="gina-toolbar-collection">';
                    html +=  '<a href="#" class="gina-toolbar-key gina-toolbar'+ isXHR +'-folding-state-'+ normalizeFoldingStateName( section, i.replace(/[^A-Za-z0-9_-]/g, '_') ) + isEmptyClass +'">'+ i +' <span>['+ obj[i].length +']</span></a>';
                    html += '<ul class="gina-toolbar-collection">' + parseCollection(obj[i], ginaObj[i], id, elIsXHR, elSection)  +'</ul>';
                    html += '</li>';
                    // clear one level
                    //id = id.substr(0, id.length - i.length - 1);
                    id = id.substr(0, id.length - i.length);
                } else {
                    objType = (ginaObj[i] === null) ? 'null' : typeof(ginaObj[i]);
                    if ( objType == 'undefined' ) { // new key  declaration added by user
                        html += '<li class="gina-toolbar-key-value">';
                        html +=     '<span class="gina-toolbar-key gina-toolbar-key-added">'+ i +':</span> <span class="gina-toolbar-value gina-toolbar-value-type-is-'+ objType +'">'+ obj[i] +'</span>';
                        html += '</li>';
                    } else {

                        if (/^_comment/.test(i) ) continue;

                        if (obj[i] !== ginaObj[i] ) {
                            html += '<li class="gina-toolbar-key-value gina-toolbar-is-overridden">';
                            html +=     '<span class="gina-toolbar-key">'+ i +':</span> <span class="gina-toolbar-value">'+ ginaObj[i] +'</span>';
                            html += '</li>';

                            html += '<li class="gina-toolbar-key-value">';
                            html +=     '<span class="gina-toolbar-key">'+ i +':</span> <span class="gina-toolbar-value gina-toolbar-value-type-is-'+ objType +'">'+ obj[i] +'</span>';
                            html += '</li>';
                        } else {
                            html += '<li class="gina-toolbar-key-value">';
                            html +=     '<span class="gina-toolbar-key">'+ i +':</span> <span class="gina-toolbar-value gina-toolbar-value-type-is-'+ objType +'">'+ obj[i] +'</span>';
                            html += '</li>';
                        }
                    }
                }
            }
            return html
        }

        var parseCollection = function (arr, ginaArr, elId, elIsXHR, elSection) {
            var html            = '';
            var id              = ( typeof(elId) != 'undefined' && elId != null ) ? elId : '';
            var section         = ( typeof(elSection) != 'undefined' && elSection != null ) ? elSection : '';
            var isXHR           = ( typeof(elIsXHR) != 'undefined' && elIsXHR != null ) ? '-xhr' : '';

            // patch 
            if (!ginaArr) {
                ginaArr = [];
            }
            for (var i = 0, len = arr.length; i<len; ++i) {
                if ( typeof(arr[i]) == 'object' && !Array.isArray(arr[i]) ) {
                    //id   += i + '-';
                    // patch 
                    if (!ginaArr[i]) {
                        ginaArr[i] = arr[i]
                    }

                    id   += '-'+ i;
                    if (section == '') {
                        section = id;
                    }
                    html += '<li class="gina-toolbar-object">';
                    html +=   '<a href="#" class="gina-toolbar-key gina-toolbar'+ isXHR +'-folding-state-'+ normalizeFoldingStateName( section, i ) +'">'+ i +' <span>{ }</span></a>';
                    html += '<ul class="gina-toolbar-object">' + parseObject(arr[i], ginaArr[i], id, elIsXHR, elSection) +'</ul>';
                    html += '</li>';
                    // clear one level
                    id = id.substr(0, id.length - i.toString().length - 1);

                } else if ( Array.isArray(arr[i]) ) {
                    //id   += i + '-';
                    id   += '-'+ i;
                    if (section == '') {
                        section = id;
                    }
                    html += '<li class="gina-toolbar-collection">';
                    html +=   '<a href="#" class="gina-toolbar-key gina-toolbar'+ isXHR +'-folding-state-'+ normalizeFoldingStateName( section, i ) +'">'+ i +'<span>[ ]</span></a>';
                    html += '<ul class="gina-toolbar-collection">' + parseCollection(arr[i], ginaArr[i], id, elIsXHR, elSection)  +'</ul>';
                    html += '</li>';
                    // clear one level
                    //id = id.substr(0, id.length - i.toString().length - 1);
                    id = id.substr(0, id.length - i.toString().length);
                } else {
                    html += '<li class="gina-toolbar-key-value"><span class="gina-toolbar-key">'+ i +':</span> <span class="gina-toolbar-value">'+ arr[i] +'</span></li>';
                }
            }
            return html
        }

        var parseView = function (obj, ginaObj, elId, elIsXHR, $html, $root) {

            var id          = (elId != null) ? elId.replace(/[^A-Za-z0-9_-]/g, '_') : '';
            var section     = null;
            var isXHR       = ( typeof(elIsXHR) != 'undefined' && elIsXHR != null ) ? '-xhr' : '';
            var count       = '';
            var objType     = '';
            var hasParent   = false;
            var $parent     = null;
            var parentId    = null;

            obj     = orderKeys(obj);
            ginaObj = orderKeys(ginaObj);

            if (!$root)
                $root = $html;

            for (var i in obj) {                
                section = i;
                if ( typeof(obj[i]) == 'object' && !Array.isArray(obj[i]) && obj[i] !== null ) { // parse

                    $parent = $('#gina-toolbar-view-' + id.substr(0, id.length - 1));
                    hasParent = ( $parent.length ) ? true : false;

                    if (!hasParent ) {
                        id += i.replace(/[^A-Za-z0-9_-]/g, '_') + '-';

                        if (i == 'params') { // force to top 
                            var htmlParams =    '<div id="gina-toolbar-view-'+ id.substr(0, id.length - 1) +'" class="gina-toolbar-section">' +
                                                    '<h2 class="gina-toolbar-section-title">'+ id.substr(0, id.length - 1) +'</h2>' +
                                                    '<ul class="'+ id.substr(0, id.length - 1) +'"></ul>' +
                                                '</div>';

                            $('#gina-toolbar-view-html-properties')
                                .before(htmlParams);
                        } else {
                            
                            if ( !/^html/.test(id) ) {
                                
                                var htmlOther = '<div id="gina-toolbar-view-'+ id.substr(0, id.length - 1) +'" class="gina-toolbar-section">' +
                                                '<h2 class="gina-toolbar-section-title">'+ id.substr(0, id.length - 1) +'</h2>' +
                                                '<ul class="'+ id.substr(0, id.length - 1) +'"></ul>' +
                                            '</div>';

                                $html
                                    .append(htmlOther);
                            }/** else { // add to properties section
                                $root
                                    .find('.gina-toolbar-properties')
                                    .append('ul.' + id.substr(0, id.length - 1))
                            }*/
                            
                        }

                        parseView(obj[i], ginaObj[i], id, elIsXHR, $html.find('ul.'+ id.substr(0, id.length - 1)), $root );

                    } else {

                        parentId = id + i.replace(/[^A-Za-z0-9_-]/g, '_') + '-';

                        $parent
                            .find('ul.'+ id.substr(0, id.length - 1))
                            .append('<li class="gina-toolbar-object"><a href="#" class="gina-toolbar-key gina-toolbar'+ isXHR +'-folding-state-'+ normalizeFoldingStateName( i.replace(/[^A-Za-z0-9_-]/g, '_'), parentId.substr(0, parentId.length - 1) ) +'">'+ i +' <span>{ }</span></a><ul class="gina-toolbar-object '+ parentId.substr(0, parentId.length - 1) +'"></ul></li>');

                        parseView(obj[i], ginaObj[i], parentId, elIsXHR, $parent.find('ul.'+ id.substr(0, id.length - 1)), $root );

                        id += i.replace(/[^A-Za-z0-9_-]/g, '_') + '-';
                    }


                    // clear one level
                    id = id.substr(0, id.length - i.length - 1);


                } else if ( Array.isArray(obj[i]) ) { // parse collection

                    
                    
                    $parent = $('#gina-toolbar-view-' + id.substr(0, id.length - 1));
                    
                    hasParent = ( $parent.length ) ? true : false;
                    
                    if ( !hasParent || /^html/.test(id) ) {                        
                        
                        $parent = $('.' + id);
                        parentId = id + i.replace(/[^A-Za-z0-9_-]/g, '_') + '-';

                        $parent
                            //.find('ul.'+ id.substr(0, id.length - 1))
                            .append('<li class="gina-toolbar-collection"><a href="#" class="gina-toolbar-key gina-toolbar'+ isXHR +'-folding-state-'+ normalizeFoldingStateName( i.replace(/[^A-Za-z0-9_-]/g, '_'), parentId.substr(0, parentId.length - 1) ) +'">'+ i +' <span>['+ obj[i].length +']</span></a><ul> '+ parseCollection(obj[i], ginaObj[i], parentId, $parent.find('li ul.'+ id.substr(0, id.length - 1)), section )+'</ul></li>');

                        
                        //parentId = parentId.substr(0, parentId.length - 1)+ '-';
                        //parentId = id.substr(0, id.length - i.length - 1);     
                        //parseView(obj[i], ginaObj[i], parentId, elIsXHR, $parent.find('ul.'+ parentId.substr(0, parentId.length - 1)), $root );

                        //id += i.replace(/[^A-Za-z0-9_-]/g, '_') + '-';
                        //$parent = $('#gina-toolbar-view-' + id.substr(0, id.length - 1));
                        id += i.replace(/[^A-Za-z0-9_-]/g, '_') + '-';
                    } else {                       
                        
                        
                        parentId = id + i.replace(/[^A-Za-z0-9_-]/g, '_') + '-';

                        $parent
                            .find('li.'+ id.substr(0, id.length - 1) +' ul')
                            .append('<li class="gina-toolbar-collection"><a class="gina-toolbar-key gina-toolbar'+ isXHR +'-folding-state-'+ normalizeFoldingStateName( i.replace(/[^A-Za-z0-9_-]/g, '_'), parentId.substr(0, parentId.length - 1) ) +'">'+ i +' <span>['+ obj[i].length +']</span></a><ul>'+ parseCollection(obj[i], ginaObj[i], parentId, $parent.find('li ul.'+ id.substr(0, id.length - 1)), section ) +'</ul></li>');

                        id += i.replace(/[^A-Za-z0-9_-]/g, '_') + '-';
                        
                    }
                    

                    // if ( !hasParent || /^html/.test(id) ) {                        
                    //     id = id + i.replace(/[^A-Za-z0-9_-]/g, '_') + '-';
                    //     $root
                    //         .find('.gina-toolbar-properties')
                    //         .append('<li class="gina-toolbar-collection"><a class="gina-toolbar-key gina-toolbar'+ isXHR +'-folding-state-'+ normalizeFoldingStateName( i.replace(/[^A-Za-z0-9_-]/g, '_'), id.substr(0, id.length - 1) ) +'">'+ i +' <span>['+ obj[i].length +']</span></a><ul>'+ parseCollection(obj[i], ginaObj[i], parentId, $root.find('.gina-toolbar-properties'), section) +'</ul></li>');


                    // } else {                       
                        
                        
                    //     parentId = id + i.replace(/[^A-Za-z0-9_-]/g, '_') + '-';

                    //     $parent
                    //         .find('li.'+ id.substr(0, id.length - 1) +' ul')
                    //         .append('<li class="gina-toolbar-collection"><a class="gina-toolbar-key gina-toolbar'+ isXHR +'-folding-state-'+ normalizeFoldingStateName( i.replace(/[^A-Za-z0-9_-]/g, '_'), parentId.substr(0, parentId.length - 1) ) +'">'+ i +' <span>['+ obj[i].length +']</span></a><ul>'+ parseCollection(obj[i], ginaObj[i], parentId, $parent.find('li ul.'+ id.substr(0, id.length - 1)), section ) +'</ul></li>');

                    //     id += i.replace(/[^A-Za-z0-9_-]/g, '_') + '-';
                    // }

                    // clear one level
                    id = id.substr(0, id.length - i.length - 1);
                } else {
                    
                    
                    
                    objType = (ginaObj[i] === null) ? 'null' : typeof(ginaObj[i]);
                    if ( objType == 'undefined' ) { // new key  declaration added by user
                        if (/\-$/.test(id)) {
                            id = id.substr(0, id.length - 1);
                        }
                        
                        if (!id) continue;
                        
                        $html
                            .find('ul.' + id)
                            .append('<li class="gina-toolbar-key-value"><span class="gina-toolbar-key gina-toolbar-key-added">'+ i +':</span> <span class="gina-toolbar-value gina-toolbar-value-type-is-'+ objType +'">'+ obj[i]+'</span></li>');

                    } else {

                        if (/^_comment/.test(i) ) continue;

                        if (obj[i] !== ginaObj[i] ) {
                            if (!id) {
                                id += i.replace(/[^A-Za-z0-9_-]/g, '_') + '-';
                            }
                            
                            try {
                                $html
                                    .find('ul.' + id)
                                    .append('<li class="gina-toolbar-key-value gina-toolbar-is-overridden"><span class="gina-toolbar-key">'+ i +':</span> <span class="gina-toolbar-value">'+ ginaObj[i] +'</span></li>');

                                $html
                                    .find('ul.' + id)
                                    .append('<li class="gina-toolbar-key-value"><span class="gina-toolbar-key">'+ i +':</span> <span class="gina-toolbar-value gina-toolbar-value-type-is-'+ objType +'">'+ obj[i] +'</span></li>')

                            } catch (err) {
                                throw new Error('GinaToolbarError: `ul.'+ id +'` not found');
                            }
                            
                        } else {

                            if ( !id || /^html\-properties/.test(id) ) { // properties case
                                // if (id) {
                                //     $html
                                //         .find('ul.' + id)
                                //         .append('<li class="gina-toolbar-key-value"><span class="gina-toolbar-key">'+ i +':</span> <span class="gina-toolbar-value gina-toolbar-value-type-is-'+ objType +'">'+ obj[i] +'</span></li>')
                                // } else {
                                    $root
                                        .find('.gina-toolbar-properties')
                                        .append('<li class="gina-toolbar-key-value"><span class="gina-toolbar-key">'+ i +':</span> <span class="gina-toolbar-value gina-toolbar-value-type-is-'+ objType +'">'+ obj[i] +'</span></li>')
                                //}                                
                                    
                            } else {
                                                            
                                $root
                                    .find('ul.' + id.substr(0, id.length - 1))
                                    .append('<li class="gina-toolbar-key-value"><span class="gina-toolbar-key">'+ i +':</span> <span class="gina-toolbar-value gina-toolbar-value-type-is-'+ objType +'">'+ obj[i] +'</span></li>')
                            }
                        }
                    }
                }
            }

            return $root.html()
        }

        var parseSection = function (rules, id, elIsXHR, section) {

            return parseObject(rules, rules, id, elIsXHR, section)
        }

        var parseForms = function (obj, ginaObj, $html, i, $forms, len, elIsXHR) {
            
            if (!len) return false;

            var attributes  = $forms[i].attributes;
            var formMethod  = null;
            var attrClass   = 'gina-toolbar-form-attributes';
            var id = $forms[i].getAttribute('id') || $forms[i].id;            
            var section     = attrClass; // by default
            var isXHR       = ( typeof(elIsXHR) != 'undefined' && elIsXHR != null ) ? '-xhr' : '';
            // form fields set
            // var fields      = validator
            //                     .getFormById(id)
            //                     .fieldsSet;

            var $form = $(
                        '<div id="gina-toolbar-form-'+ id +'" class="gina-toolbar-section">' +
                            '<h2 class="gina-toolbar-section-title">'+ id +'</h2>' +
                            '<ul class="gina-toolbar-section-content gina-toolbar-code" style="display: none;">' +
                                '<li class="'+ attrClass +'">' +
                                    '<h3 class="gina-toolbar-sub-section-title">'+ attrClass.replace(/gina-toolbar-form-/, '') +'</h3>' +
                                    '<ul class="gina-toolbar-code"></ul>' +
                                '</li>' +
                            '</ul>' +
                        '</div>');

            var key         = null
                , val       = null
                , content   = null
                , hasEvents = false
                , routeObj  = null
            ;

            // testing for action attr to add action route            
           

            // adding form attributes
            for ( var a = 0, aLen = attributes.length; a < aLen; ++a ) {

                key     = attributes[a].name;
                val     = attributes[a].nodeValue;

                // filters
                if ( /^method$/.test(key) )
                    val = val.toUpperCase();

                if ( /^class$/.test(key) && /\s+/.test(val) )
                    val = '<ul><li>'+ val.replace(/\s+/g, '</li><li>') +'</li></ul>';

                if ( /^action$/.test(key) ) {
                    
                    formMethod  = ( typeof(attributes['method']) != 'undefined' ) ? attributes['method'].nodeValue : undefined;                   
                    routeObj    = routing.getRouteByUrl(val, formMethod);

                    if ( typeof(routeObj) == 'undefined' || !routeObj ) {
                        routeObj = {
                            name: 'not found',
                            namespace: 'not found',
                            param: {
                                control: 'not found',
                                file: 'not found'
                            }
                        }
                    } 
                    
                    val =   '<ul>' +
                                '<li>' +
                                    '<span class="gina-toolbar-key">url</span>' +
                                    '<span class="gina-toolbar-value">' + (val || '#') + '</span>' +
                                '</li>' +
                                '<li>' +
                                    '<span class="gina-toolbar-key">route</span>' +
                                    '<span class="gina-toolbar-value">' + routeObj.name +'</span>' +
                                '</li>' +
                                '<li>' +
                                    '<span class="gina-toolbar-key">namespace</span>' +
                                    '<span class="gina-toolbar-value">' + (routeObj.namespace || 'root controller') + '</span>' +
                                '</li>' +
                                '<li>' +
                                    '<span class="gina-toolbar-key">control</span>' +
                                    '<span class="gina-toolbar-value">' + routeObj.param.control + '</span>' +
                                '</li>' +
                                '<li>' +
                                    '<span class="gina-toolbar-key">file</span>' +
                                    '<span class="gina-toolbar-value">' + routeObj.param.file + '</span>' +
                                '</li>' +
                            '<ul>';

                    content =   '<li>' +
                                    '<span class="gina-toolbar-key">' + key + ':</span>' +
                                    '<span class="gina-toolbar-value">' + val + '</span>' +
                                '</li>';
                }

                //content = val;


                // events
                if ( /^data-gina-form-event/.test(key) ) {
                    section     = 'events';
                    hasEvents   = ( $form
                                    .find('.'+ attrClass)
                                    .find('.gina-toolbar-key-events').length ) ? true : false;

                    key = key.replace(/^data-gina-form-event-/, '');

                    if (!hasEvents) {
                        // adding event sub section
                        $form
                            .find('ul.gina-toolbar-section-content')
                            .append('<li class="gina-toolbar-form-'+ section +'">' +
                                        '<h3 class="gina-toolbar-sub-section-title">'+ section +'</h3>' +
                                        '<ul class="gina-toolbar-code"></ul>' +
                                    '</li>');

                    }

                    
                    content =   '<li>' +
                                    '<span class="gina-toolbar-key">'+ key +':</span>' +
                                    '<span class="gina-toolbar-value">'+ val +'</span>' +
                                '</li>';


                    $form
                        .find('ul.gina-toolbar-section-content')
                        .find('li.gina-toolbar-form-'+ section +' > ul')
                        .append(content)


                } else { // normal case

                    if (!/^action$/.test(key)) {
                        content = '<li>' +
                                    '<span class="gina-toolbar-key">' + key + ':</span>' +
                                    '<span class="gina-toolbar-value">' + val + '</span>' +
                                '</li>';
                    }

                    $form
                        .find('ul.gina-toolbar-section-content')
                        .find('li.'+ attrClass +' > ul')
                        .append(content)
                }


            }

            // adding form rules
            var rules = null;

            try {
                
                var dataRule = $forms[i].getAttribute('data-gina-form-rule');
                
                if ( typeof(dataRule) != 'undefined' && dataRule!= null ) {
                    rules = eval('gina.forms.rules.' + dataRule.replace(/-/g, '.'))
                } else {
                    rules = eval('gina.forms.rules.' + id.replace(/-/g, '.'))
                }
                
            } catch (err) {}

            if ( rules ) {
                section = 'rules';
                $form
                    .find('ul.gina-toolbar-section-content')
                    .append('<li class="gina-toolbar-form-'+ section +'">' +
                                '<h3 class="gina-toolbar-sub-section-title">'+ section +'</h3>' +
                                '<ul class="gina-toolbar-properties">'+ parseSection( rules, id, elIsXHR, section ) +'</ul>' +
                            '</li>');                
                
            }



            $html.append($form);

            ++i;

            if (i < len) {
                parseForms(obj, ginaObj, $html, i, $forms, len, elIsXHR)
            }
        }

        var updateForm = function(id, section, obj, elIsXHR) {

            var $form = $('#gina-toolbar-form-' + id);

            // reset
            $section = $form
                .find('ul.gina-toolbar-section-content')
                .find('li.gina-toolbar-form-'+ section + '> ul');

            if ( $section.length > 0) { // update

                if ( obj.count() == 0 ) { // no errors remove section
                    $form
                        .find('ul.gina-toolbar-section-content')
                        .find('li.gina-toolbar-form-' + section)
                        .remove();
                    return false
                }

                $section
                    .html( parseSection( obj, id, elIsXHR, section ) );

            } else { // init

                $form
                .find('ul.gina-toolbar-section-content')
                .append('<li class="gina-toolbar-form-'+ section +'">' +
                            '<h3 class="gina-toolbar-sub-section-title">'+ section +'</h3>' +
                            '<ul class="gina-toolbar-properties">'+ parseSection( obj, id, elIsXHR, section ) +'</ul>' +
                        '</li>');
            }

            // Form binding
            var $sectionContent = $form.find('ul.gina-toolbar-section-content');
            if ( !$sectionContent.is(':visible') ) {
                $sectionContent.slideToggle()
            }
            
        }

        var createInputFile = function(id, label) {

            var html = null;

            html  = '<label class="gina-toolbar-input-file">';
            html += '<input type="file" multiple id="' + id +'">';
            html += label;
            html += '</label>';

            return html
        }

        var loadJSON = function(txt, cb) {

            var html = createInputFile('mock', 'Select your JSON file');

            $htmlData.html(html);
            $json.text('');

            $htmlData.find('input').off('change').on('change', function(e) {

                var files   = $(this)[0].files;
                var file    = null;
                var reader  = null;


                if (files.length == 1) {
                    file        = $(this)[0].files[0]; // jQuery way
                    reader      = new FileReader();
                    reader.addEventListener('load', function(){
                        // user
                        $json.text(reader.result);
                        // gina <- being duplicated to prevent bugs
                        $ginaJson.text(reader.result);
                        cb();
                    }, false);

                    reader.readAsBinaryString(file)
                } else {
                    var done = 0;
                    var complete = function (done) {

                        if (done == files.length) {
                            cb()
                        }
                    };

                    reader  = [];

                    for (var i = 0, len = files.length; i < len; ++i) {
                        file = files[i];
                        switch (true) {
                            case /user/.test(file.name):

                                reader[i]  = new FileReader();
                                reader[i].addEventListener('load', function onEventListenerAdded(e){

                                    // user
                                    $json.text(e.currentTarget.result);
                                    ++done;
                                    complete(done)
                                }, false);

                                reader[i].readAsBinaryString(file);

                                break;

                            case /gina/.test(file.name):
                                //console.log(file);
                                reader[i]  = new FileReader();
                                reader[i].addEventListener('load', function onEventListenerAdded(e){
                                    // gina
                                    $ginaJson.text(e.currentTarget.result);
                                    ++done;
                                    complete(done)
                                }, false);

                                reader[i].readAsBinaryString(file);

                                break;
                        }
                    }
                }

            });

            return false;
        }

        var makeFoldingPaths = function(obj, tmp) {
            for (var r in obj) {
                if ( typeof(obj[r]) == 'object' ) {
                    self.foldingPaths[tmp + r] = tmp + r;
                    makeFoldingPaths(obj[r], tmp + r+'-');
                }
            }
        }

        this.update = function (section, data) {
            loadData(section, data);
        }

        this.restore = function () {
            // get last jsonObject.data state
            if (lastJsonObjectState && typeof (lastJsonObjectState.data) != 'undefined' ) {
                originalData.jsonObject.data = lastJsonObjectState.data;
            }

            loadData('data', originalData.jsonObject, originalData.ginaJsonObject);
        }

        
        if ( typeof(gina.validator) != 'undefined' ) {
            gina.validator.on('initialized', function onValidatorReady(){
                console.log('toolbar validator ready');
                init();
            })
        } else {
            init();
        }       
        
    }

    return Toolbar
});
define('gina', [ 'require', 'vendor/uuid', 'utils/merge', 'utils/events', 'helpers/dateFormat', 'gina/toolbar' ], function (require) {
    
    
    var eventsHandler   = require('utils/events'); // events handler
    var merge           = require('utils/merge');
    var dateFormat      = require('helpers/dateFormat')();
    var uuid            = require('vendor/uuid');



    /**
     * Imports & definitions
     * */

    var jQuery = (window['jQuery']) ? window['jQuery'] : null;

    if (!window.process ) {
        (function(window, nextTick, process, prefixes, i, p, fnc) {
            p = window[process] || (window[process] = {});
            while (!fnc && i < prefixes.length) {
                fnc = window[prefixes[i++] + 'equestAnimationFrame'];
            }
            p[nextTick] = p[nextTick] || (fnc && fnc.bind(window)) || window.setImmediate || window.setTimeout;
        })(window, 'nextTick', 'process', 'r webkitR mozR msR oR'.split(' '), 0);
    }

    if (!window.getComputedStyle) {
        /**
         * Returns the roster widget element.
         * @this {Window}
         * @return {ComputedStyle}
         */

        window.getComputedStyle = function(el, pseudo) {
            this.el = el;
            this.getPropertyValue = function(prop) {
                var re = /(\-([a-z]){1})/g;
                if (prop == 'float') {
                    prop = 'styleFloat'
                }
                if (re.test(prop)) {
                    prop = prop.replace(re, function () {
                        return arguments[2].toUpperCase()
                    })
                }
                return el.currentStyle[prop] ? el.currentStyle[prop] : null
            }
            return this
        }
    }

    /**
     * Custom object properties definition
     * */

    Object.defineProperty( Date.prototype, 'format', {
        writable:   false,
        enumerable: false,
        //If loaded several times, it can lead to an exception. That's why I put this.
        configurable: true,
        value: function(mask, utc){ return dateFormat.format(this, mask, utc) }
    });


    Object.defineProperty( Object.prototype, 'count', {
        writable: true,
        enumerable: false,
        //If loaded several times, it can lead to an exception. That's why I put this.
        configurable: true,
        value: function(){
            try {
                var self = this;
                if (this instanceof String) self = JSON.parse(this);
                var i = 0;
                for (var prop in this)
                    if (this.hasOwnProperty(prop)) ++i;

                return i
            } catch (err) {
                return i
            }
        }
    });


    function construct(gina) {

        this.plugin         = 'gina';

        var events          = [ 'ginaloaded', 'ready' ];

        /**
         * setOptions
         * Override default config options or add new options properties
         *
         * @param {object} options
         * */
        var setOptions = function(options) {
            proto.config = merge(proto.config, options, true)
        }

        var proto           = { // instance proto
            'id'                : 'gina-' + uuid.v1(),

            'plugin'            : this.plugin,
            'on'                : on,
            'eventData'         : {},
            'target'            : document, // by default
        };

        document.id = proto.id;

        var $instance       = {
            'id'                : proto.id,

            'isFrameworkLoaded' : false,
            'hasValidator'      : false,
            'hasPopinHandler'   : false,
            'config'           : {},
            'registeredEvents'  : {},
            'events'            : {},

            'setOptions'        : setOptions
        };
        
        // iframe case
        if ( typeof(parent.window['gina']) != 'undefined' ) {
            // inheriting from parent frame instance
            window['gina'] = merge((window['gina'] || {}), parent.window['gina']);
        }
        $instance = merge( (window['gina'] || {}), $instance);

        registerEvents(this.plugin, events);
        
        triggerEvent(gina, proto.target, 'ginaloaded', $instance)
    }

    return construct
});
(function webpackUniversalModuleDefinition(root, factory) {
	if(typeof exports === 'object' && typeof module === 'object')
		module.exports = factory();
	else if(typeof define === 'function' && define.amd)
		define('vendor/engine.io',[], factory);
	else if(typeof exports === 'object')
		exports["eio"] = factory();
	else
		root["eio"] = factory();
})(this, function() {
return /******/ (function(modules) { // webpackBootstrap
/******/ 	// The module cache
/******/ 	var installedModules = {};

/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {

/******/ 		// Check if module is in cache
/******/ 		if(installedModules[moduleId])
/******/ 			return installedModules[moduleId].exports;

/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = installedModules[moduleId] = {
/******/ 			exports: {},
/******/ 			id: moduleId,
/******/ 			loaded: false
/******/ 		};

/******/ 		// Execute the module function
/******/ 		modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);

/******/ 		// Flag the module as loaded
/******/ 		module.loaded = true;

/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}


/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = modules;

/******/ 	// expose the module cache
/******/ 	__webpack_require__.c = installedModules;

/******/ 	// __webpack_public_path__
/******/ 	__webpack_require__.p = "";

/******/ 	// Load entry module and return exports
/******/ 	return __webpack_require__(0);
/******/ })
/************************************************************************/
/******/ ([
/* 0 */
/***/ function(module, exports, __webpack_require__) {

	
	module.exports = __webpack_require__(1);

	/**
	 * Exports parser
	 *
	 * @api public
	 *
	 */
	module.exports.parser = __webpack_require__(8);


/***/ },
/* 1 */
/***/ function(module, exports, __webpack_require__) {

	/**
	 * Module dependencies.
	 */

	var transports = __webpack_require__(2);
	var Emitter = __webpack_require__(17);
	var debug = __webpack_require__(21)('engine.io-client:socket');
	var index = __webpack_require__(28);
	var parser = __webpack_require__(8);
	var parseuri = __webpack_require__(29);
	var parseqs = __webpack_require__(18);

	/**
	 * Module exports.
	 */

	module.exports = Socket;

	/**
	 * Socket constructor.
	 *
	 * @param {String|Object} uri or options
	 * @param {Object} options
	 * @api public
	 */

	function Socket (uri, opts) {
	  if (!(this instanceof Socket)) return new Socket(uri, opts);

	  opts = opts || {};

	  if (uri && 'object' === typeof uri) {
	    opts = uri;
	    uri = null;
	  }

	  if (uri) {
	    uri = parseuri(uri);
	    opts.hostname = uri.host;
	    opts.secure = uri.protocol === 'https' || uri.protocol === 'wss';
	    opts.port = uri.port;
	    if (uri.query) opts.query = uri.query;
	  } else if (opts.host) {
	    opts.hostname = parseuri(opts.host).host;
	  }

	  this.secure = null != opts.secure ? opts.secure
	    : (typeof location !== 'undefined' && 'https:' === location.protocol);

	  if (opts.hostname && !opts.port) {
	    // if no port is specified manually, use the protocol default
	    opts.port = this.secure ? '443' : '80';
	  }

	  this.agent = opts.agent || false;
	  this.hostname = opts.hostname ||
	    (typeof location !== 'undefined' ? location.hostname : 'localhost');
	  this.port = opts.port || (typeof location !== 'undefined' && location.port
	      ? location.port
	      : (this.secure ? 443 : 80));
	  this.query = opts.query || {};
	  if ('string' === typeof this.query) this.query = parseqs.decode(this.query);
	  this.upgrade = false !== opts.upgrade;
	  this.path = (opts.path || '/engine.io').replace(/\/$/, '') + '/';
	  this.forceJSONP = !!opts.forceJSONP;
	  this.jsonp = false !== opts.jsonp;
	  this.forceBase64 = !!opts.forceBase64;
	  this.enablesXDR = !!opts.enablesXDR;
	  this.withCredentials = false !== opts.withCredentials;
	  this.timestampParam = opts.timestampParam || 't';
	  this.timestampRequests = opts.timestampRequests;
	  this.transports = opts.transports || ['polling', 'websocket'];
	  this.transportOptions = opts.transportOptions || {};
	  this.readyState = '';
	  this.writeBuffer = [];
	  this.prevBufferLen = 0;
	  this.policyPort = opts.policyPort || 843;
	  this.rememberUpgrade = opts.rememberUpgrade || false;
	  this.binaryType = null;
	  this.onlyBinaryUpgrades = opts.onlyBinaryUpgrades;
	  this.perMessageDeflate = false !== opts.perMessageDeflate ? (opts.perMessageDeflate || {}) : false;

	  if (true === this.perMessageDeflate) this.perMessageDeflate = {};
	  if (this.perMessageDeflate && null == this.perMessageDeflate.threshold) {
	    this.perMessageDeflate.threshold = 1024;
	  }

	  // SSL options for Node.js client
	  this.pfx = opts.pfx || null;
	  this.key = opts.key || null;
	  this.passphrase = opts.passphrase || null;
	  this.cert = opts.cert || null;
	  this.ca = opts.ca || null;
	  this.ciphers = opts.ciphers || null;
	  this.rejectUnauthorized = opts.rejectUnauthorized === undefined ? true : opts.rejectUnauthorized;
	  this.forceNode = !!opts.forceNode;

	  // detect ReactNative environment
	  this.isReactNative = (typeof navigator !== 'undefined' && typeof navigator.product === 'string' && navigator.product.toLowerCase() === 'reactnative');

	  // other options for Node.js or ReactNative client
	  if (typeof self === 'undefined' || this.isReactNative) {
	    if (opts.extraHeaders && Object.keys(opts.extraHeaders).length > 0) {
	      this.extraHeaders = opts.extraHeaders;
	    }

	    if (opts.localAddress) {
	      this.localAddress = opts.localAddress;
	    }
	  }

	  // set on handshake
	  this.id = null;
	  this.upgrades = null;
	  this.pingInterval = null;
	  this.pingTimeout = null;

	  // set on heartbeat
	  this.pingIntervalTimer = null;
	  this.pingTimeoutTimer = null;

	  this.open();
	}

	Socket.priorWebsocketSuccess = false;

	/**
	 * Mix in `Emitter`.
	 */

	Emitter(Socket.prototype);

	/**
	 * Protocol version.
	 *
	 * @api public
	 */

	Socket.protocol = parser.protocol; // this is an int

	/**
	 * Expose deps for legacy compatibility
	 * and standalone browser access.
	 */

	Socket.Socket = Socket;
	Socket.Transport = __webpack_require__(7);
	Socket.transports = __webpack_require__(2);
	Socket.parser = __webpack_require__(8);

	/**
	 * Creates transport of the given type.
	 *
	 * @param {String} transport name
	 * @return {Transport}
	 * @api private
	 */

	Socket.prototype.createTransport = function (name) {
	  debug('creating transport "%s"', name);
	  var query = clone(this.query);

	  // append engine.io protocol identifier
	  query.EIO = parser.protocol;

	  // transport name
	  query.transport = name;

	  // per-transport options
	  var options = this.transportOptions[name] || {};

	  // session id if we already have one
	  if (this.id) query.sid = this.id;

	  var transport = new transports[name]({
	    query: query,
	    socket: this,
	    agent: options.agent || this.agent,
	    hostname: options.hostname || this.hostname,
	    port: options.port || this.port,
	    secure: options.secure || this.secure,
	    path: options.path || this.path,
	    forceJSONP: options.forceJSONP || this.forceJSONP,
	    jsonp: options.jsonp || this.jsonp,
	    forceBase64: options.forceBase64 || this.forceBase64,
	    enablesXDR: options.enablesXDR || this.enablesXDR,
	    withCredentials: options.withCredentials || this.withCredentials,
	    timestampRequests: options.timestampRequests || this.timestampRequests,
	    timestampParam: options.timestampParam || this.timestampParam,
	    policyPort: options.policyPort || this.policyPort,
	    pfx: options.pfx || this.pfx,
	    key: options.key || this.key,
	    passphrase: options.passphrase || this.passphrase,
	    cert: options.cert || this.cert,
	    ca: options.ca || this.ca,
	    ciphers: options.ciphers || this.ciphers,
	    rejectUnauthorized: options.rejectUnauthorized || this.rejectUnauthorized,
	    perMessageDeflate: options.perMessageDeflate || this.perMessageDeflate,
	    extraHeaders: options.extraHeaders || this.extraHeaders,
	    forceNode: options.forceNode || this.forceNode,
	    localAddress: options.localAddress || this.localAddress,
	    requestTimeout: options.requestTimeout || this.requestTimeout,
	    protocols: options.protocols || void (0),
	    isReactNative: this.isReactNative
	  });

	  return transport;
	};

	function clone (obj) {
	  var o = {};
	  for (var i in obj) {
	    if (obj.hasOwnProperty(i)) {
	      o[i] = obj[i];
	    }
	  }
	  return o;
	}

	/**
	 * Initializes transport to use and starts probe.
	 *
	 * @api private
	 */
	Socket.prototype.open = function () {
	  var transport;
	  if (this.rememberUpgrade && Socket.priorWebsocketSuccess && this.transports.indexOf('websocket') !== -1) {
	    transport = 'websocket';
	  } else if (0 === this.transports.length) {
	    // Emit error on next tick so it can be listened to
	    var self = this;
	    setTimeout(function () {
	      self.emit('error', 'No transports available');
	    }, 0);
	    return;
	  } else {
	    transport = this.transports[0];
	  }
	  this.readyState = 'opening';

	  // Retry with the next transport if the transport is disabled (jsonp: false)
	  try {
	    transport = this.createTransport(transport);
	  } catch (e) {
	    this.transports.shift();
	    this.open();
	    return;
	  }

	  transport.open();
	  this.setTransport(transport);
	};

	/**
	 * Sets the current transport. Disables the existing one (if any).
	 *
	 * @api private
	 */

	Socket.prototype.setTransport = function (transport) {
	  debug('setting transport %s', transport.name);
	  var self = this;

	  if (this.transport) {
	    debug('clearing existing transport %s', this.transport.name);
	    this.transport.removeAllListeners();
	  }

	  // set up transport
	  this.transport = transport;

	  // set up transport listeners
	  transport
	  .on('drain', function () {
	    self.onDrain();
	  })
	  .on('packet', function (packet) {
	    self.onPacket(packet);
	  })
	  .on('error', function (e) {
	    self.onError(e);
	  })
	  .on('close', function () {
	    self.onClose('transport close');
	  });
	};

	/**
	 * Probes a transport.
	 *
	 * @param {String} transport name
	 * @api private
	 */

	Socket.prototype.probe = function (name) {
	  debug('probing transport "%s"', name);
	  var transport = this.createTransport(name, { probe: 1 });
	  var failed = false;
	  var self = this;

	  Socket.priorWebsocketSuccess = false;

	  function onTransportOpen () {
	    if (self.onlyBinaryUpgrades) {
	      var upgradeLosesBinary = !this.supportsBinary && self.transport.supportsBinary;
	      failed = failed || upgradeLosesBinary;
	    }
	    if (failed) return;

	    debug('probe transport "%s" opened', name);
	    transport.send([{ type: 'ping', data: 'probe' }]);
	    transport.once('packet', function (msg) {
	      if (failed) return;
	      if ('pong' === msg.type && 'probe' === msg.data) {
	        debug('probe transport "%s" pong', name);
	        self.upgrading = true;
	        self.emit('upgrading', transport);
	        if (!transport) return;
	        Socket.priorWebsocketSuccess = 'websocket' === transport.name;

	        debug('pausing current transport "%s"', self.transport.name);
	        self.transport.pause(function () {
	          if (failed) return;
	          if ('closed' === self.readyState) return;
	          debug('changing transport and sending upgrade packet');

	          cleanup();

	          self.setTransport(transport);
	          transport.send([{ type: 'upgrade' }]);
	          self.emit('upgrade', transport);
	          transport = null;
	          self.upgrading = false;
	          self.flush();
	        });
	      } else {
	        debug('probe transport "%s" failed', name);
	        var err = new Error('probe error');
	        err.transport = transport.name;
	        self.emit('upgradeError', err);
	      }
	    });
	  }

	  function freezeTransport () {
	    if (failed) return;

	    // Any callback called by transport should be ignored since now
	    failed = true;

	    cleanup();

	    transport.close();
	    transport = null;
	  }

	  // Handle any error that happens while probing
	  function onerror (err) {
	    var error = new Error('probe error: ' + err);
	    error.transport = transport.name;

	    freezeTransport();

	    debug('probe transport "%s" failed because of error: %s', name, err);

	    self.emit('upgradeError', error);
	  }

	  function onTransportClose () {
	    onerror('transport closed');
	  }

	  // When the socket is closed while we're probing
	  function onclose () {
	    onerror('socket closed');
	  }

	  // When the socket is upgraded while we're probing
	  function onupgrade (to) {
	    if (transport && to.name !== transport.name) {
	      debug('"%s" works - aborting "%s"', to.name, transport.name);
	      freezeTransport();
	    }
	  }

	  // Remove all listeners on the transport and on self
	  function cleanup () {
	    transport.removeListener('open', onTransportOpen);
	    transport.removeListener('error', onerror);
	    transport.removeListener('close', onTransportClose);
	    self.removeListener('close', onclose);
	    self.removeListener('upgrading', onupgrade);
	  }

	  transport.once('open', onTransportOpen);
	  transport.once('error', onerror);
	  transport.once('close', onTransportClose);

	  this.once('close', onclose);
	  this.once('upgrading', onupgrade);

	  transport.open();
	};

	/**
	 * Called when connection is deemed open.
	 *
	 * @api public
	 */

	Socket.prototype.onOpen = function () {
	  debug('socket open');
	  this.readyState = 'open';
	  Socket.priorWebsocketSuccess = 'websocket' === this.transport.name;
	  this.emit('open');
	  this.flush();

	  // we check for `readyState` in case an `open`
	  // listener already closed the socket
	  if ('open' === this.readyState && this.upgrade && this.transport.pause) {
	    debug('starting upgrade probes');
	    for (var i = 0, l = this.upgrades.length; i < l; i++) {
	      this.probe(this.upgrades[i]);
	    }
	  }
	};

	/**
	 * Handles a packet.
	 *
	 * @api private
	 */

	Socket.prototype.onPacket = function (packet) {
	  if ('opening' === this.readyState || 'open' === this.readyState ||
	      'closing' === this.readyState) {
	    debug('socket receive: type "%s", data "%s"', packet.type, packet.data);

	    this.emit('packet', packet);

	    // Socket is live - any packet counts
	    this.emit('heartbeat');

	    switch (packet.type) {
	      case 'open':
	        this.onHandshake(JSON.parse(packet.data));
	        break;

	      case 'pong':
	        this.setPing();
	        this.emit('pong');
	        break;

	      case 'error':
	        var err = new Error('server error');
	        err.code = packet.data;
	        this.onError(err);
	        break;

	      case 'message':
	        this.emit('data', packet.data);
	        this.emit('message', packet.data);
	        break;
	    }
	  } else {
	    debug('packet received with socket readyState "%s"', this.readyState);
	  }
	};

	/**
	 * Called upon handshake completion.
	 *
	 * @param {Object} handshake obj
	 * @api private
	 */

	Socket.prototype.onHandshake = function (data) {
	  this.emit('handshake', data);
	  this.id = data.sid;
	  this.transport.query.sid = data.sid;
	  this.upgrades = this.filterUpgrades(data.upgrades);
	  this.pingInterval = data.pingInterval;
	  this.pingTimeout = data.pingTimeout;
	  this.onOpen();
	  // In case open handler closes socket
	  if ('closed' === this.readyState) return;
	  this.setPing();

	  // Prolong liveness of socket on heartbeat
	  this.removeListener('heartbeat', this.onHeartbeat);
	  this.on('heartbeat', this.onHeartbeat);
	};

	/**
	 * Resets ping timeout.
	 *
	 * @api private
	 */

	Socket.prototype.onHeartbeat = function (timeout) {
	  clearTimeout(this.pingTimeoutTimer);
	  var self = this;
	  self.pingTimeoutTimer = setTimeout(function () {
	    if ('closed' === self.readyState) return;
	    self.onClose('ping timeout');
	  }, timeout || (self.pingInterval + self.pingTimeout));
	};

	/**
	 * Pings server every `this.pingInterval` and expects response
	 * within `this.pingTimeout` or closes connection.
	 *
	 * @api private
	 */

	Socket.prototype.setPing = function () {
	  var self = this;
	  clearTimeout(self.pingIntervalTimer);
	  self.pingIntervalTimer = setTimeout(function () {
	    debug('writing ping packet - expecting pong within %sms', self.pingTimeout);
	    self.ping();
	    self.onHeartbeat(self.pingTimeout);
	  }, self.pingInterval);
	};

	/**
	* Sends a ping packet.
	*
	* @api private
	*/

	Socket.prototype.ping = function () {
	  var self = this;
	  this.sendPacket('ping', function () {
	    self.emit('ping');
	  });
	};

	/**
	 * Called on `drain` event
	 *
	 * @api private
	 */

	Socket.prototype.onDrain = function () {
	  this.writeBuffer.splice(0, this.prevBufferLen);

	  // setting prevBufferLen = 0 is very important
	  // for example, when upgrading, upgrade packet is sent over,
	  // and a nonzero prevBufferLen could cause problems on `drain`
	  this.prevBufferLen = 0;

	  if (0 === this.writeBuffer.length) {
	    this.emit('drain');
	  } else {
	    this.flush();
	  }
	};

	/**
	 * Flush write buffers.
	 *
	 * @api private
	 */

	Socket.prototype.flush = function () {
	  if ('closed' !== this.readyState && this.transport.writable &&
	    !this.upgrading && this.writeBuffer.length) {
	    debug('flushing %d packets in socket', this.writeBuffer.length);
	    this.transport.send(this.writeBuffer);
	    // keep track of current length of writeBuffer
	    // splice writeBuffer and callbackBuffer on `drain`
	    this.prevBufferLen = this.writeBuffer.length;
	    this.emit('flush');
	  }
	};

	/**
	 * Sends a message.
	 *
	 * @param {String} message.
	 * @param {Function} callback function.
	 * @param {Object} options.
	 * @return {Socket} for chaining.
	 * @api public
	 */

	Socket.prototype.write =
	Socket.prototype.send = function (msg, options, fn) {
	  this.sendPacket('message', msg, options, fn);
	  return this;
	};

	/**
	 * Sends a packet.
	 *
	 * @param {String} packet type.
	 * @param {String} data.
	 * @param {Object} options.
	 * @param {Function} callback function.
	 * @api private
	 */

	Socket.prototype.sendPacket = function (type, data, options, fn) {
	  if ('function' === typeof data) {
	    fn = data;
	    data = undefined;
	  }

	  if ('function' === typeof options) {
	    fn = options;
	    options = null;
	  }

	  if ('closing' === this.readyState || 'closed' === this.readyState) {
	    return;
	  }

	  options = options || {};
	  options.compress = false !== options.compress;

	  var packet = {
	    type: type,
	    data: data,
	    options: options
	  };
	  this.emit('packetCreate', packet);
	  this.writeBuffer.push(packet);
	  if (fn) this.once('flush', fn);
	  this.flush();
	};

	/**
	 * Closes the connection.
	 *
	 * @api private
	 */

	Socket.prototype.close = function () {
	  if ('opening' === this.readyState || 'open' === this.readyState) {
	    this.readyState = 'closing';

	    var self = this;

	    if (this.writeBuffer.length) {
	      this.once('drain', function () {
	        if (this.upgrading) {
	          waitForUpgrade();
	        } else {
	          close();
	        }
	      });
	    } else if (this.upgrading) {
	      waitForUpgrade();
	    } else {
	      close();
	    }
	  }

	  function close () {
	    self.onClose('forced close');
	    debug('socket closing - telling transport to close');
	    self.transport.close();
	  }

	  function cleanupAndClose () {
	    self.removeListener('upgrade', cleanupAndClose);
	    self.removeListener('upgradeError', cleanupAndClose);
	    close();
	  }

	  function waitForUpgrade () {
	    // wait for upgrade to finish since we can't send packets while pausing a transport
	    self.once('upgrade', cleanupAndClose);
	    self.once('upgradeError', cleanupAndClose);
	  }

	  return this;
	};

	/**
	 * Called upon transport error
	 *
	 * @api private
	 */

	Socket.prototype.onError = function (err) {
	  debug('socket error %j', err);
	  Socket.priorWebsocketSuccess = false;
	  this.emit('error', err);
	  this.onClose('transport error', err);
	};

	/**
	 * Called upon transport close.
	 *
	 * @api private
	 */

	Socket.prototype.onClose = function (reason, desc) {
	  if ('opening' === this.readyState || 'open' === this.readyState || 'closing' === this.readyState) {
	    debug('socket close with reason: "%s"', reason);
	    var self = this;

	    // clear timers
	    clearTimeout(this.pingIntervalTimer);
	    clearTimeout(this.pingTimeoutTimer);

	    // stop event from firing again for transport
	    this.transport.removeAllListeners('close');

	    // ensure transport won't stay open
	    this.transport.close();

	    // ignore further transport communication
	    this.transport.removeAllListeners();

	    // set ready state
	    this.readyState = 'closed';

	    // clear session id
	    this.id = null;

	    // emit close event
	    this.emit('close', reason, desc);

	    // clean buffers after, so users can still
	    // grab the buffers on `close` event
	    self.writeBuffer = [];
	    self.prevBufferLen = 0;
	  }
	};

	/**
	 * Filters upgrades, returning only those matching client transports.
	 *
	 * @param {Array} server upgrades
	 * @api private
	 *
	 */

	Socket.prototype.filterUpgrades = function (upgrades) {
	  var filteredUpgrades = [];
	  for (var i = 0, j = upgrades.length; i < j; i++) {
	    if (~index(this.transports, upgrades[i])) filteredUpgrades.push(upgrades[i]);
	  }
	  return filteredUpgrades;
	};


/***/ },
/* 2 */
/***/ function(module, exports, __webpack_require__) {

	/**
	 * Module dependencies
	 */

	var XMLHttpRequest = __webpack_require__(3);
	var XHR = __webpack_require__(5);
	var JSONP = __webpack_require__(25);
	var websocket = __webpack_require__(26);

	/**
	 * Export transports.
	 */

	exports.polling = polling;
	exports.websocket = websocket;

	/**
	 * Polling transport polymorphic constructor.
	 * Decides on xhr vs jsonp based on feature detection.
	 *
	 * @api private
	 */

	function polling (opts) {
	  var xhr;
	  var xd = false;
	  var xs = false;
	  var jsonp = false !== opts.jsonp;

	  if (typeof location !== 'undefined') {
	    var isSSL = 'https:' === location.protocol;
	    var port = location.port;

	    // some user agents have empty `location.port`
	    if (!port) {
	      port = isSSL ? 443 : 80;
	    }

	    xd = opts.hostname !== location.hostname || port !== opts.port;
	    xs = opts.secure !== isSSL;
	  }

	  opts.xdomain = xd;
	  opts.xscheme = xs;
	  xhr = new XMLHttpRequest(opts);

	  if ('open' in xhr && !opts.forceJSONP) {
	    return new XHR(opts);
	  } else {
	    if (!jsonp) throw new Error('JSONP disabled');
	    return new JSONP(opts);
	  }
	}


/***/ },
/* 3 */
/***/ function(module, exports, __webpack_require__) {

	// browser shim for xmlhttprequest module

	var hasCORS = __webpack_require__(4);

	module.exports = function (opts) {
	  var xdomain = opts.xdomain;

	  // scheme must be same when usign XDomainRequest
	  // http://blogs.msdn.com/b/ieinternals/archive/2010/05/13/xdomainrequest-restrictions-limitations-and-workarounds.aspx
	  var xscheme = opts.xscheme;

	  // XDomainRequest has a flow of not sending cookie, therefore it should be disabled as a default.
	  // https://github.com/Automattic/engine.io-client/pull/217
	  var enablesXDR = opts.enablesXDR;

	  // XMLHttpRequest can be disabled on IE
	  try {
	    if ('undefined' !== typeof XMLHttpRequest && (!xdomain || hasCORS)) {
	      return new XMLHttpRequest();
	    }
	  } catch (e) { }

	  // Use XDomainRequest for IE8 if enablesXDR is true
	  // because loading bar keeps flashing when using jsonp-polling
	  // https://github.com/yujiosaka/socke.io-ie8-loading-example
	  try {
	    if ('undefined' !== typeof XDomainRequest && !xscheme && enablesXDR) {
	      return new XDomainRequest();
	    }
	  } catch (e) { }

	  if (!xdomain) {
	    try {
	      return new self[['Active'].concat('Object').join('X')]('Microsoft.XMLHTTP');
	    } catch (e) { }
	  }
	};


/***/ },
/* 4 */
/***/ function(module, exports) {

	
	/**
	 * Module exports.
	 *
	 * Logic borrowed from Modernizr:
	 *
	 *   - https://github.com/Modernizr/Modernizr/blob/master/feature-detects/cors.js
	 */

	try {
	  module.exports = typeof XMLHttpRequest !== 'undefined' &&
	    'withCredentials' in new XMLHttpRequest();
	} catch (err) {
	  // if XMLHttp support is disabled in IE then it will throw
	  // when trying to create
	  module.exports = false;
	}


/***/ },
/* 5 */
/***/ function(module, exports, __webpack_require__) {

	/* global attachEvent */

	/**
	 * Module requirements.
	 */

	var XMLHttpRequest = __webpack_require__(3);
	var Polling = __webpack_require__(6);
	var Emitter = __webpack_require__(17);
	var inherit = __webpack_require__(19);
	var debug = __webpack_require__(21)('engine.io-client:polling-xhr');

	/**
	 * Module exports.
	 */

	module.exports = XHR;
	module.exports.Request = Request;

	/**
	 * Empty function
	 */

	function empty () {}

	/**
	 * XHR Polling constructor.
	 *
	 * @param {Object} opts
	 * @api public
	 */

	function XHR (opts) {
	  Polling.call(this, opts);
	  this.requestTimeout = opts.requestTimeout;
	  this.extraHeaders = opts.extraHeaders;

	  if (typeof location !== 'undefined') {
	    var isSSL = 'https:' === location.protocol;
	    var port = location.port;

	    // some user agents have empty `location.port`
	    if (!port) {
	      port = isSSL ? 443 : 80;
	    }

	    this.xd = (typeof location !== 'undefined' && opts.hostname !== location.hostname) ||
	      port !== opts.port;
	    this.xs = opts.secure !== isSSL;
	  }
	}

	/**
	 * Inherits from Polling.
	 */

	inherit(XHR, Polling);

	/**
	 * XHR supports binary
	 */

	XHR.prototype.supportsBinary = true;

	/**
	 * Creates a request.
	 *
	 * @param {String} method
	 * @api private
	 */

	XHR.prototype.request = function (opts) {
	  opts = opts || {};
	  opts.uri = this.uri();
	  opts.xd = this.xd;
	  opts.xs = this.xs;
	  opts.agent = this.agent || false;
	  opts.supportsBinary = this.supportsBinary;
	  opts.enablesXDR = this.enablesXDR;
	  opts.withCredentials = this.withCredentials;

	  // SSL options for Node.js client
	  opts.pfx = this.pfx;
	  opts.key = this.key;
	  opts.passphrase = this.passphrase;
	  opts.cert = this.cert;
	  opts.ca = this.ca;
	  opts.ciphers = this.ciphers;
	  opts.rejectUnauthorized = this.rejectUnauthorized;
	  opts.requestTimeout = this.requestTimeout;

	  // other options for Node.js client
	  opts.extraHeaders = this.extraHeaders;

	  return new Request(opts);
	};

	/**
	 * Sends data.
	 *
	 * @param {String} data to send.
	 * @param {Function} called upon flush.
	 * @api private
	 */

	XHR.prototype.doWrite = function (data, fn) {
	  var isBinary = typeof data !== 'string' && data !== undefined;
	  var req = this.request({ method: 'POST', data: data, isBinary: isBinary });
	  var self = this;
	  req.on('success', fn);
	  req.on('error', function (err) {
	    self.onError('xhr post error', err);
	  });
	  this.sendXhr = req;
	};

	/**
	 * Starts a poll cycle.
	 *
	 * @api private
	 */

	XHR.prototype.doPoll = function () {
	  debug('xhr poll');
	  var req = this.request();
	  var self = this;
	  req.on('data', function (data) {
	    self.onData(data);
	  });
	  req.on('error', function (err) {
	    self.onError('xhr poll error', err);
	  });
	  this.pollXhr = req;
	};

	/**
	 * Request constructor
	 *
	 * @param {Object} options
	 * @api public
	 */

	function Request (opts) {
	  this.method = opts.method || 'GET';
	  this.uri = opts.uri;
	  this.xd = !!opts.xd;
	  this.xs = !!opts.xs;
	  this.async = false !== opts.async;
	  this.data = undefined !== opts.data ? opts.data : null;
	  this.agent = opts.agent;
	  this.isBinary = opts.isBinary;
	  this.supportsBinary = opts.supportsBinary;
	  this.enablesXDR = opts.enablesXDR;
	  this.withCredentials = opts.withCredentials;
	  this.requestTimeout = opts.requestTimeout;

	  // SSL options for Node.js client
	  this.pfx = opts.pfx;
	  this.key = opts.key;
	  this.passphrase = opts.passphrase;
	  this.cert = opts.cert;
	  this.ca = opts.ca;
	  this.ciphers = opts.ciphers;
	  this.rejectUnauthorized = opts.rejectUnauthorized;

	  // other options for Node.js client
	  this.extraHeaders = opts.extraHeaders;

	  this.create();
	}

	/**
	 * Mix in `Emitter`.
	 */

	Emitter(Request.prototype);

	/**
	 * Creates the XHR object and sends the request.
	 *
	 * @api private
	 */

	Request.prototype.create = function () {
	  var opts = { agent: this.agent, xdomain: this.xd, xscheme: this.xs, enablesXDR: this.enablesXDR };

	  // SSL options for Node.js client
	  opts.pfx = this.pfx;
	  opts.key = this.key;
	  opts.passphrase = this.passphrase;
	  opts.cert = this.cert;
	  opts.ca = this.ca;
	  opts.ciphers = this.ciphers;
	  opts.rejectUnauthorized = this.rejectUnauthorized;

	  var xhr = this.xhr = new XMLHttpRequest(opts);
	  var self = this;

	  try {
	    debug('xhr open %s: %s', this.method, this.uri);
	    xhr.open(this.method, this.uri, this.async);
	    try {
	      if (this.extraHeaders) {
	        xhr.setDisableHeaderCheck && xhr.setDisableHeaderCheck(true);
	        for (var i in this.extraHeaders) {
	          if (this.extraHeaders.hasOwnProperty(i)) {
	            xhr.setRequestHeader(i, this.extraHeaders[i]);
	          }
	        }
	      }
	    } catch (e) {}

	    if ('POST' === this.method) {
	      try {
	        if (this.isBinary) {
	          xhr.setRequestHeader('Content-type', 'application/octet-stream');
	        } else {
	          xhr.setRequestHeader('Content-type', 'text/plain;charset=UTF-8');
	        }
	      } catch (e) {}
	    }

	    try {
	      xhr.setRequestHeader('Accept', '*/*');
	    } catch (e) {}

	    // ie6 check
	    if ('withCredentials' in xhr) {
	      xhr.withCredentials = this.withCredentials;
	    }

	    if (this.requestTimeout) {
	      xhr.timeout = this.requestTimeout;
	    }

	    if (this.hasXDR()) {
	      xhr.onload = function () {
	        self.onLoad();
	      };
	      xhr.onerror = function () {
	        self.onError(xhr.responseText);
	      };
	    } else {
	      xhr.onreadystatechange = function () {
	        if (xhr.readyState === 2) {
	          try {
	            var contentType = xhr.getResponseHeader('Content-Type');
	            if (self.supportsBinary && contentType === 'application/octet-stream' || contentType === 'application/octet-stream; charset=UTF-8') {
	              xhr.responseType = 'arraybuffer';
	            }
	          } catch (e) {}
	        }
	        if (4 !== xhr.readyState) return;
	        if (200 === xhr.status || 1223 === xhr.status) {
	          self.onLoad();
	        } else {
	          // make sure the `error` event handler that's user-set
	          // does not throw in the same tick and gets caught here
	          setTimeout(function () {
	            self.onError(typeof xhr.status === 'number' ? xhr.status : 0);
	          }, 0);
	        }
	      };
	    }

	    debug('xhr data %s', this.data);
	    xhr.send(this.data);
	  } catch (e) {
	    // Need to defer since .create() is called directly fhrom the constructor
	    // and thus the 'error' event can only be only bound *after* this exception
	    // occurs.  Therefore, also, we cannot throw here at all.
	    setTimeout(function () {
	      self.onError(e);
	    }, 0);
	    return;
	  }

	  if (typeof document !== 'undefined') {
	    this.index = Request.requestsCount++;
	    Request.requests[this.index] = this;
	  }
	};

	/**
	 * Called upon successful response.
	 *
	 * @api private
	 */

	Request.prototype.onSuccess = function () {
	  this.emit('success');
	  this.cleanup();
	};

	/**
	 * Called if we have data.
	 *
	 * @api private
	 */

	Request.prototype.onData = function (data) {
	  this.emit('data', data);
	  this.onSuccess();
	};

	/**
	 * Called upon error.
	 *
	 * @api private
	 */

	Request.prototype.onError = function (err) {
	  this.emit('error', err);
	  this.cleanup(true);
	};

	/**
	 * Cleans up house.
	 *
	 * @api private
	 */

	Request.prototype.cleanup = function (fromError) {
	  if ('undefined' === typeof this.xhr || null === this.xhr) {
	    return;
	  }
	  // xmlhttprequest
	  if (this.hasXDR()) {
	    this.xhr.onload = this.xhr.onerror = empty;
	  } else {
	    this.xhr.onreadystatechange = empty;
	  }

	  if (fromError) {
	    try {
	      this.xhr.abort();
	    } catch (e) {}
	  }

	  if (typeof document !== 'undefined') {
	    delete Request.requests[this.index];
	  }

	  this.xhr = null;
	};

	/**
	 * Called upon load.
	 *
	 * @api private
	 */

	Request.prototype.onLoad = function () {
	  var data;
	  try {
	    var contentType;
	    try {
	      contentType = this.xhr.getResponseHeader('Content-Type');
	    } catch (e) {}
	    if (contentType === 'application/octet-stream' || contentType === 'application/octet-stream; charset=UTF-8') {
	      data = this.xhr.response || this.xhr.responseText;
	    } else {
	      data = this.xhr.responseText;
	    }
	  } catch (e) {
	    this.onError(e);
	  }
	  if (null != data) {
	    this.onData(data);
	  }
	};

	/**
	 * Check if it has XDomainRequest.
	 *
	 * @api private
	 */

	Request.prototype.hasXDR = function () {
	  return typeof XDomainRequest !== 'undefined' && !this.xs && this.enablesXDR;
	};

	/**
	 * Aborts the request.
	 *
	 * @api public
	 */

	Request.prototype.abort = function () {
	  this.cleanup();
	};

	/**
	 * Aborts pending requests when unloading the window. This is needed to prevent
	 * memory leaks (e.g. when using IE) and to ensure that no spurious error is
	 * emitted.
	 */

	Request.requestsCount = 0;
	Request.requests = {};

	if (typeof document !== 'undefined') {
	  if (typeof attachEvent === 'function') {
	    attachEvent('onunload', unloadHandler);
	  } else if (typeof addEventListener === 'function') {
	    var terminationEvent = 'onpagehide' in self ? 'pagehide' : 'unload';
	    addEventListener(terminationEvent, unloadHandler, false);
	  }
	}

	function unloadHandler () {
	  for (var i in Request.requests) {
	    if (Request.requests.hasOwnProperty(i)) {
	      Request.requests[i].abort();
	    }
	  }
	}


/***/ },
/* 6 */
/***/ function(module, exports, __webpack_require__) {

	/**
	 * Module dependencies.
	 */

	var Transport = __webpack_require__(7);
	var parseqs = __webpack_require__(18);
	var parser = __webpack_require__(8);
	var inherit = __webpack_require__(19);
	var yeast = __webpack_require__(20);
	var debug = __webpack_require__(21)('engine.io-client:polling');

	/**
	 * Module exports.
	 */

	module.exports = Polling;

	/**
	 * Is XHR2 supported?
	 */

	var hasXHR2 = (function () {
	  var XMLHttpRequest = __webpack_require__(3);
	  var xhr = new XMLHttpRequest({ xdomain: false });
	  return null != xhr.responseType;
	})();

	/**
	 * Polling interface.
	 *
	 * @param {Object} opts
	 * @api private
	 */

	function Polling (opts) {
	  var forceBase64 = (opts && opts.forceBase64);
	  if (!hasXHR2 || forceBase64) {
	    this.supportsBinary = false;
	  }
	  Transport.call(this, opts);
	}

	/**
	 * Inherits from Transport.
	 */

	inherit(Polling, Transport);

	/**
	 * Transport name.
	 */

	Polling.prototype.name = 'polling';

	/**
	 * Opens the socket (triggers polling). We write a PING message to determine
	 * when the transport is open.
	 *
	 * @api private
	 */

	Polling.prototype.doOpen = function () {
	  this.poll();
	};

	/**
	 * Pauses polling.
	 *
	 * @param {Function} callback upon buffers are flushed and transport is paused
	 * @api private
	 */

	Polling.prototype.pause = function (onPause) {
	  var self = this;

	  this.readyState = 'pausing';

	  function pause () {
	    debug('paused');
	    self.readyState = 'paused';
	    onPause();
	  }

	  if (this.polling || !this.writable) {
	    var total = 0;

	    if (this.polling) {
	      debug('we are currently polling - waiting to pause');
	      total++;
	      this.once('pollComplete', function () {
	        debug('pre-pause polling complete');
	        --total || pause();
	      });
	    }

	    if (!this.writable) {
	      debug('we are currently writing - waiting to pause');
	      total++;
	      this.once('drain', function () {
	        debug('pre-pause writing complete');
	        --total || pause();
	      });
	    }
	  } else {
	    pause();
	  }
	};

	/**
	 * Starts polling cycle.
	 *
	 * @api public
	 */

	Polling.prototype.poll = function () {
	  debug('polling');
	  this.polling = true;
	  this.doPoll();
	  this.emit('poll');
	};

	/**
	 * Overloads onData to detect payloads.
	 *
	 * @api private
	 */

	Polling.prototype.onData = function (data) {
	  var self = this;
	  debug('polling got data %s', data);
	  var callback = function (packet, index, total) {
	    // if its the first message we consider the transport open
	    if ('opening' === self.readyState) {
	      self.onOpen();
	    }

	    // if its a close packet, we close the ongoing requests
	    if ('close' === packet.type) {
	      self.onClose();
	      return false;
	    }

	    // otherwise bypass onData and handle the message
	    self.onPacket(packet);
	  };

	  // decode payload
	  parser.decodePayload(data, this.socket.binaryType, callback);

	  // if an event did not trigger closing
	  if ('closed' !== this.readyState) {
	    // if we got data we're not polling
	    this.polling = false;
	    this.emit('pollComplete');

	    if ('open' === this.readyState) {
	      this.poll();
	    } else {
	      debug('ignoring poll - transport state "%s"', this.readyState);
	    }
	  }
	};

	/**
	 * For polling, send a close packet.
	 *
	 * @api private
	 */

	Polling.prototype.doClose = function () {
	  var self = this;

	  function close () {
	    debug('writing close packet');
	    self.write([{ type: 'close' }]);
	  }

	  if ('open' === this.readyState) {
	    debug('transport open - closing');
	    close();
	  } else {
	    // in case we're trying to close while
	    // handshaking is in progress (GH-164)
	    debug('transport not open - deferring close');
	    this.once('open', close);
	  }
	};

	/**
	 * Writes a packets payload.
	 *
	 * @param {Array} data packets
	 * @param {Function} drain callback
	 * @api private
	 */

	Polling.prototype.write = function (packets) {
	  var self = this;
	  this.writable = false;
	  var callbackfn = function () {
	    self.writable = true;
	    self.emit('drain');
	  };

	  parser.encodePayload(packets, this.supportsBinary, function (data) {
	    self.doWrite(data, callbackfn);
	  });
	};

	/**
	 * Generates uri for connection.
	 *
	 * @api private
	 */

	Polling.prototype.uri = function () {
	  var query = this.query || {};
	  var schema = this.secure ? 'https' : 'http';
	  var port = '';

	  // cache busting is forced
	  if (false !== this.timestampRequests) {
	    query[this.timestampParam] = yeast();
	  }

	  if (!this.supportsBinary && !query.sid) {
	    query.b64 = 1;
	  }

	  query = parseqs.encode(query);

	  // avoid port if default for schema
	  if (this.port && (('https' === schema && Number(this.port) !== 443) ||
	     ('http' === schema && Number(this.port) !== 80))) {
	    port = ':' + this.port;
	  }

	  // prepend ? to query
	  if (query.length) {
	    query = '?' + query;
	  }

	  var ipv6 = this.hostname.indexOf(':') !== -1;
	  return schema + '://' + (ipv6 ? '[' + this.hostname + ']' : this.hostname) + port + this.path + query;
	};


/***/ },
/* 7 */
/***/ function(module, exports, __webpack_require__) {

	/**
	 * Module dependencies.
	 */

	var parser = __webpack_require__(8);
	var Emitter = __webpack_require__(17);

	/**
	 * Module exports.
	 */

	module.exports = Transport;

	/**
	 * Transport abstract constructor.
	 *
	 * @param {Object} options.
	 * @api private
	 */

	function Transport (opts) {
	  this.path = opts.path;
	  this.hostname = opts.hostname;
	  this.port = opts.port;
	  this.secure = opts.secure;
	  this.query = opts.query;
	  this.timestampParam = opts.timestampParam;
	  this.timestampRequests = opts.timestampRequests;
	  this.readyState = '';
	  this.agent = opts.agent || false;
	  this.socket = opts.socket;
	  this.enablesXDR = opts.enablesXDR;
	  this.withCredentials = opts.withCredentials;

	  // SSL options for Node.js client
	  this.pfx = opts.pfx;
	  this.key = opts.key;
	  this.passphrase = opts.passphrase;
	  this.cert = opts.cert;
	  this.ca = opts.ca;
	  this.ciphers = opts.ciphers;
	  this.rejectUnauthorized = opts.rejectUnauthorized;
	  this.forceNode = opts.forceNode;

	  // results of ReactNative environment detection
	  this.isReactNative = opts.isReactNative;

	  // other options for Node.js client
	  this.extraHeaders = opts.extraHeaders;
	  this.localAddress = opts.localAddress;
	}

	/**
	 * Mix in `Emitter`.
	 */

	Emitter(Transport.prototype);

	/**
	 * Emits an error.
	 *
	 * @param {String} str
	 * @return {Transport} for chaining
	 * @api public
	 */

	Transport.prototype.onError = function (msg, desc) {
	  var err = new Error(msg);
	  err.type = 'TransportError';
	  err.description = desc;
	  this.emit('error', err);
	  return this;
	};

	/**
	 * Opens the transport.
	 *
	 * @api public
	 */

	Transport.prototype.open = function () {
	  if ('closed' === this.readyState || '' === this.readyState) {
	    this.readyState = 'opening';
	    this.doOpen();
	  }

	  return this;
	};

	/**
	 * Closes the transport.
	 *
	 * @api private
	 */

	Transport.prototype.close = function () {
	  if ('opening' === this.readyState || 'open' === this.readyState) {
	    this.doClose();
	    this.onClose();
	  }

	  return this;
	};

	/**
	 * Sends multiple packets.
	 *
	 * @param {Array} packets
	 * @api private
	 */

	Transport.prototype.send = function (packets) {
	  if ('open' === this.readyState) {
	    this.write(packets);
	  } else {
	    throw new Error('Transport not open');
	  }
	};

	/**
	 * Called upon open
	 *
	 * @api private
	 */

	Transport.prototype.onOpen = function () {
	  this.readyState = 'open';
	  this.writable = true;
	  this.emit('open');
	};

	/**
	 * Called with data.
	 *
	 * @param {String} data
	 * @api private
	 */

	Transport.prototype.onData = function (data) {
	  var packet = parser.decodePacket(data, this.socket.binaryType);
	  this.onPacket(packet);
	};

	/**
	 * Called with a decoded packet.
	 */

	Transport.prototype.onPacket = function (packet) {
	  this.emit('packet', packet);
	};

	/**
	 * Called upon close.
	 *
	 * @api private
	 */

	Transport.prototype.onClose = function () {
	  this.readyState = 'closed';
	  this.emit('close');
	};


/***/ },
/* 8 */
/***/ function(module, exports, __webpack_require__) {

	/**
	 * Module dependencies.
	 */

	var keys = __webpack_require__(9);
	var hasBinary = __webpack_require__(10);
	var sliceBuffer = __webpack_require__(12);
	var after = __webpack_require__(13);
	var utf8 = __webpack_require__(14);

	var base64encoder;
	if (typeof ArrayBuffer !== 'undefined') {
	  base64encoder = __webpack_require__(15);
	}

	/**
	 * Check if we are running an android browser. That requires us to use
	 * ArrayBuffer with polling transports...
	 *
	 * http://ghinda.net/jpeg-blob-ajax-android/
	 */

	var isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

	/**
	 * Check if we are running in PhantomJS.
	 * Uploading a Blob with PhantomJS does not work correctly, as reported here:
	 * https://github.com/ariya/phantomjs/issues/11395
	 * @type boolean
	 */
	var isPhantomJS = typeof navigator !== 'undefined' && /PhantomJS/i.test(navigator.userAgent);

	/**
	 * When true, avoids using Blobs to encode payloads.
	 * @type boolean
	 */
	var dontSendBlobs = isAndroid || isPhantomJS;

	/**
	 * Current protocol version.
	 */

	exports.protocol = 3;

	/**
	 * Packet types.
	 */

	var packets = exports.packets = {
	    open:     0    // non-ws
	  , close:    1    // non-ws
	  , ping:     2
	  , pong:     3
	  , message:  4
	  , upgrade:  5
	  , noop:     6
	};

	var packetslist = keys(packets);

	/**
	 * Premade error packet.
	 */

	var err = { type: 'error', data: 'parser error' };

	/**
	 * Create a blob api even for blob builder when vendor prefixes exist
	 */

	var Blob = __webpack_require__(16);

	/**
	 * Encodes a packet.
	 *
	 *     <packet type id> [ <data> ]
	 *
	 * Example:
	 *
	 *     5hello world
	 *     3
	 *     4
	 *
	 * Binary is encoded in an identical principle
	 *
	 * @api private
	 */

	exports.encodePacket = function (packet, supportsBinary, utf8encode, callback) {
	  if (typeof supportsBinary === 'function') {
	    callback = supportsBinary;
	    supportsBinary = false;
	  }

	  if (typeof utf8encode === 'function') {
	    callback = utf8encode;
	    utf8encode = null;
	  }

	  var data = (packet.data === undefined)
	    ? undefined
	    : packet.data.buffer || packet.data;

	  if (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) {
	    return encodeArrayBuffer(packet, supportsBinary, callback);
	  } else if (typeof Blob !== 'undefined' && data instanceof Blob) {
	    return encodeBlob(packet, supportsBinary, callback);
	  }

	  // might be an object with { base64: true, data: dataAsBase64String }
	  if (data && data.base64) {
	    return encodeBase64Object(packet, callback);
	  }

	  // Sending data as a utf-8 string
	  var encoded = packets[packet.type];

	  // data fragment is optional
	  if (undefined !== packet.data) {
	    encoded += utf8encode ? utf8.encode(String(packet.data), { strict: false }) : String(packet.data);
	  }

	  return callback('' + encoded);

	};

	function encodeBase64Object(packet, callback) {
	  // packet data is an object { base64: true, data: dataAsBase64String }
	  var message = 'b' + exports.packets[packet.type] + packet.data.data;
	  return callback(message);
	}

	/**
	 * Encode packet helpers for binary types
	 */

	function encodeArrayBuffer(packet, supportsBinary, callback) {
	  if (!supportsBinary) {
	    return exports.encodeBase64Packet(packet, callback);
	  }

	  var data = packet.data;
	  var contentArray = new Uint8Array(data);
	  var resultBuffer = new Uint8Array(1 + data.byteLength);

	  resultBuffer[0] = packets[packet.type];
	  for (var i = 0; i < contentArray.length; i++) {
	    resultBuffer[i+1] = contentArray[i];
	  }

	  return callback(resultBuffer.buffer);
	}

	function encodeBlobAsArrayBuffer(packet, supportsBinary, callback) {
	  if (!supportsBinary) {
	    return exports.encodeBase64Packet(packet, callback);
	  }

	  var fr = new FileReader();
	  fr.onload = function() {
	    exports.encodePacket({ type: packet.type, data: fr.result }, supportsBinary, true, callback);
	  };
	  return fr.readAsArrayBuffer(packet.data);
	}

	function encodeBlob(packet, supportsBinary, callback) {
	  if (!supportsBinary) {
	    return exports.encodeBase64Packet(packet, callback);
	  }

	  if (dontSendBlobs) {
	    return encodeBlobAsArrayBuffer(packet, supportsBinary, callback);
	  }

	  var length = new Uint8Array(1);
	  length[0] = packets[packet.type];
	  var blob = new Blob([length.buffer, packet.data]);

	  return callback(blob);
	}

	/**
	 * Encodes a packet with binary data in a base64 string
	 *
	 * @param {Object} packet, has `type` and `data`
	 * @return {String} base64 encoded message
	 */

	exports.encodeBase64Packet = function(packet, callback) {
	  var message = 'b' + exports.packets[packet.type];
	  if (typeof Blob !== 'undefined' && packet.data instanceof Blob) {
	    var fr = new FileReader();
	    fr.onload = function() {
	      var b64 = fr.result.split(',')[1];
	      callback(message + b64);
	    };
	    return fr.readAsDataURL(packet.data);
	  }

	  var b64data;
	  try {
	    b64data = String.fromCharCode.apply(null, new Uint8Array(packet.data));
	  } catch (e) {
	    // iPhone Safari doesn't let you apply with typed arrays
	    var typed = new Uint8Array(packet.data);
	    var basic = new Array(typed.length);
	    for (var i = 0; i < typed.length; i++) {
	      basic[i] = typed[i];
	    }
	    b64data = String.fromCharCode.apply(null, basic);
	  }
	  message += btoa(b64data);
	  return callback(message);
	};

	/**
	 * Decodes a packet. Changes format to Blob if requested.
	 *
	 * @return {Object} with `type` and `data` (if any)
	 * @api private
	 */

	exports.decodePacket = function (data, binaryType, utf8decode) {
	  if (data === undefined) {
	    return err;
	  }
	  // String data
	  if (typeof data === 'string') {
	    if (data.charAt(0) === 'b') {
	      return exports.decodeBase64Packet(data.substr(1), binaryType);
	    }

	    if (utf8decode) {
	      data = tryDecode(data);
	      if (data === false) {
	        return err;
	      }
	    }
	    var type = data.charAt(0);

	    if (Number(type) != type || !packetslist[type]) {
	      return err;
	    }

	    if (data.length > 1) {
	      return { type: packetslist[type], data: data.substring(1) };
	    } else {
	      return { type: packetslist[type] };
	    }
	  }

	  var asArray = new Uint8Array(data);
	  var type = asArray[0];
	  var rest = sliceBuffer(data, 1);
	  if (Blob && binaryType === 'blob') {
	    rest = new Blob([rest]);
	  }
	  return { type: packetslist[type], data: rest };
	};

	function tryDecode(data) {
	  try {
	    data = utf8.decode(data, { strict: false });
	  } catch (e) {
	    return false;
	  }
	  return data;
	}

	/**
	 * Decodes a packet encoded in a base64 string
	 *
	 * @param {String} base64 encoded message
	 * @return {Object} with `type` and `data` (if any)
	 */

	exports.decodeBase64Packet = function(msg, binaryType) {
	  var type = packetslist[msg.charAt(0)];
	  if (!base64encoder) {
	    return { type: type, data: { base64: true, data: msg.substr(1) } };
	  }

	  var data = base64encoder.decode(msg.substr(1));

	  if (binaryType === 'blob' && Blob) {
	    data = new Blob([data]);
	  }

	  return { type: type, data: data };
	};

	/**
	 * Encodes multiple messages (payload).
	 *
	 *     <length>:data
	 *
	 * Example:
	 *
	 *     11:hello world2:hi
	 *
	 * If any contents are binary, they will be encoded as base64 strings. Base64
	 * encoded strings are marked with a b before the length specifier
	 *
	 * @param {Array} packets
	 * @api private
	 */

	exports.encodePayload = function (packets, supportsBinary, callback) {
	  if (typeof supportsBinary === 'function') {
	    callback = supportsBinary;
	    supportsBinary = null;
	  }

	  var isBinary = hasBinary(packets);

	  if (supportsBinary && isBinary) {
	    if (Blob && !dontSendBlobs) {
	      return exports.encodePayloadAsBlob(packets, callback);
	    }

	    return exports.encodePayloadAsArrayBuffer(packets, callback);
	  }

	  if (!packets.length) {
	    return callback('0:');
	  }

	  function setLengthHeader(message) {
	    return message.length + ':' + message;
	  }

	  function encodeOne(packet, doneCallback) {
	    exports.encodePacket(packet, !isBinary ? false : supportsBinary, false, function(message) {
	      doneCallback(null, setLengthHeader(message));
	    });
	  }

	  map(packets, encodeOne, function(err, results) {
	    return callback(results.join(''));
	  });
	};

	/**
	 * Async array map using after
	 */

	function map(ary, each, done) {
	  var result = new Array(ary.length);
	  var next = after(ary.length, done);

	  var eachWithIndex = function(i, el, cb) {
	    each(el, function(error, msg) {
	      result[i] = msg;
	      cb(error, result);
	    });
	  };

	  for (var i = 0; i < ary.length; i++) {
	    eachWithIndex(i, ary[i], next);
	  }
	}

	/*
	 * Decodes data when a payload is maybe expected. Possible binary contents are
	 * decoded from their base64 representation
	 *
	 * @param {String} data, callback method
	 * @api public
	 */

	exports.decodePayload = function (data, binaryType, callback) {
	  if (typeof data !== 'string') {
	    return exports.decodePayloadAsBinary(data, binaryType, callback);
	  }

	  if (typeof binaryType === 'function') {
	    callback = binaryType;
	    binaryType = null;
	  }

	  var packet;
	  if (data === '') {
	    // parser error - ignoring payload
	    return callback(err, 0, 1);
	  }

	  var length = '', n, msg;

	  for (var i = 0, l = data.length; i < l; i++) {
	    var chr = data.charAt(i);

	    if (chr !== ':') {
	      length += chr;
	      continue;
	    }

	    if (length === '' || (length != (n = Number(length)))) {
	      // parser error - ignoring payload
	      return callback(err, 0, 1);
	    }

	    msg = data.substr(i + 1, n);

	    if (length != msg.length) {
	      // parser error - ignoring payload
	      return callback(err, 0, 1);
	    }

	    if (msg.length) {
	      packet = exports.decodePacket(msg, binaryType, false);

	      if (err.type === packet.type && err.data === packet.data) {
	        // parser error in individual packet - ignoring payload
	        return callback(err, 0, 1);
	      }

	      var ret = callback(packet, i + n, l);
	      if (false === ret) return;
	    }

	    // advance cursor
	    i += n;
	    length = '';
	  }

	  if (length !== '') {
	    // parser error - ignoring payload
	    return callback(err, 0, 1);
	  }

	};

	/**
	 * Encodes multiple messages (payload) as binary.
	 *
	 * <1 = binary, 0 = string><number from 0-9><number from 0-9>[...]<number
	 * 255><data>
	 *
	 * Example:
	 * 1 3 255 1 2 3, if the binary contents are interpreted as 8 bit integers
	 *
	 * @param {Array} packets
	 * @return {ArrayBuffer} encoded payload
	 * @api private
	 */

	exports.encodePayloadAsArrayBuffer = function(packets, callback) {
	  if (!packets.length) {
	    return callback(new ArrayBuffer(0));
	  }

	  function encodeOne(packet, doneCallback) {
	    exports.encodePacket(packet, true, true, function(data) {
	      return doneCallback(null, data);
	    });
	  }

	  map(packets, encodeOne, function(err, encodedPackets) {
	    var totalLength = encodedPackets.reduce(function(acc, p) {
	      var len;
	      if (typeof p === 'string'){
	        len = p.length;
	      } else {
	        len = p.byteLength;
	      }
	      return acc + len.toString().length + len + 2; // string/binary identifier + separator = 2
	    }, 0);

	    var resultArray = new Uint8Array(totalLength);

	    var bufferIndex = 0;
	    encodedPackets.forEach(function(p) {
	      var isString = typeof p === 'string';
	      var ab = p;
	      if (isString) {
	        var view = new Uint8Array(p.length);
	        for (var i = 0; i < p.length; i++) {
	          view[i] = p.charCodeAt(i);
	        }
	        ab = view.buffer;
	      }

	      if (isString) { // not true binary
	        resultArray[bufferIndex++] = 0;
	      } else { // true binary
	        resultArray[bufferIndex++] = 1;
	      }

	      var lenStr = ab.byteLength.toString();
	      for (var i = 0; i < lenStr.length; i++) {
	        resultArray[bufferIndex++] = parseInt(lenStr[i]);
	      }
	      resultArray[bufferIndex++] = 255;

	      var view = new Uint8Array(ab);
	      for (var i = 0; i < view.length; i++) {
	        resultArray[bufferIndex++] = view[i];
	      }
	    });

	    return callback(resultArray.buffer);
	  });
	};

	/**
	 * Encode as Blob
	 */

	exports.encodePayloadAsBlob = function(packets, callback) {
	  function encodeOne(packet, doneCallback) {
	    exports.encodePacket(packet, true, true, function(encoded) {
	      var binaryIdentifier = new Uint8Array(1);
	      binaryIdentifier[0] = 1;
	      if (typeof encoded === 'string') {
	        var view = new Uint8Array(encoded.length);
	        for (var i = 0; i < encoded.length; i++) {
	          view[i] = encoded.charCodeAt(i);
	        }
	        encoded = view.buffer;
	        binaryIdentifier[0] = 0;
	      }

	      var len = (encoded instanceof ArrayBuffer)
	        ? encoded.byteLength
	        : encoded.size;

	      var lenStr = len.toString();
	      var lengthAry = new Uint8Array(lenStr.length + 1);
	      for (var i = 0; i < lenStr.length; i++) {
	        lengthAry[i] = parseInt(lenStr[i]);
	      }
	      lengthAry[lenStr.length] = 255;

	      if (Blob) {
	        var blob = new Blob([binaryIdentifier.buffer, lengthAry.buffer, encoded]);
	        doneCallback(null, blob);
	      }
	    });
	  }

	  map(packets, encodeOne, function(err, results) {
	    return callback(new Blob(results));
	  });
	};

	/*
	 * Decodes data when a payload is maybe expected. Strings are decoded by
	 * interpreting each byte as a key code for entries marked to start with 0. See
	 * description of encodePayloadAsBinary
	 *
	 * @param {ArrayBuffer} data, callback method
	 * @api public
	 */

	exports.decodePayloadAsBinary = function (data, binaryType, callback) {
	  if (typeof binaryType === 'function') {
	    callback = binaryType;
	    binaryType = null;
	  }

	  var bufferTail = data;
	  var buffers = [];

	  while (bufferTail.byteLength > 0) {
	    var tailArray = new Uint8Array(bufferTail);
	    var isString = tailArray[0] === 0;
	    var msgLength = '';

	    for (var i = 1; ; i++) {
	      if (tailArray[i] === 255) break;

	      // 310 = char length of Number.MAX_VALUE
	      if (msgLength.length > 310) {
	        return callback(err, 0, 1);
	      }

	      msgLength += tailArray[i];
	    }

	    bufferTail = sliceBuffer(bufferTail, 2 + msgLength.length);
	    msgLength = parseInt(msgLength);

	    var msg = sliceBuffer(bufferTail, 0, msgLength);
	    if (isString) {
	      try {
	        msg = String.fromCharCode.apply(null, new Uint8Array(msg));
	      } catch (e) {
	        // iPhone Safari doesn't let you apply to typed arrays
	        var typed = new Uint8Array(msg);
	        msg = '';
	        for (var i = 0; i < typed.length; i++) {
	          msg += String.fromCharCode(typed[i]);
	        }
	      }
	    }

	    buffers.push(msg);
	    bufferTail = sliceBuffer(bufferTail, msgLength);
	  }

	  var total = buffers.length;
	  buffers.forEach(function(buffer, i) {
	    callback(exports.decodePacket(buffer, binaryType, true), i, total);
	  });
	};


/***/ },
/* 9 */
/***/ function(module, exports) {

	
	/**
	 * Gets the keys for an object.
	 *
	 * @return {Array} keys
	 * @api private
	 */

	module.exports = Object.keys || function keys (obj){
	  var arr = [];
	  var has = Object.prototype.hasOwnProperty;

	  for (var i in obj) {
	    if (has.call(obj, i)) {
	      arr.push(i);
	    }
	  }
	  return arr;
	};


/***/ },
/* 10 */
/***/ function(module, exports, __webpack_require__) {

	/* global Blob File */

	/*
	 * Module requirements.
	 */

	var isArray = __webpack_require__(11);

	var toString = Object.prototype.toString;
	var withNativeBlob = typeof Blob === 'function' ||
	                        typeof Blob !== 'undefined' && toString.call(Blob) === '[object BlobConstructor]';
	var withNativeFile = typeof File === 'function' ||
	                        typeof File !== 'undefined' && toString.call(File) === '[object FileConstructor]';

	/**
	 * Module exports.
	 */

	module.exports = hasBinary;

	/**
	 * Checks for binary data.
	 *
	 * Supports Buffer, ArrayBuffer, Blob and File.
	 *
	 * @param {Object} anything
	 * @api public
	 */

	function hasBinary (obj) {
	  if (!obj || typeof obj !== 'object') {
	    return false;
	  }

	  if (isArray(obj)) {
	    for (var i = 0, l = obj.length; i < l; i++) {
	      if (hasBinary(obj[i])) {
	        return true;
	      }
	    }
	    return false;
	  }

	  if ((typeof Buffer === 'function' && Buffer.isBuffer && Buffer.isBuffer(obj)) ||
	    (typeof ArrayBuffer === 'function' && obj instanceof ArrayBuffer) ||
	    (withNativeBlob && obj instanceof Blob) ||
	    (withNativeFile && obj instanceof File)
	  ) {
	    return true;
	  }

	  // see: https://github.com/Automattic/has-binary/pull/4
	  if (obj.toJSON && typeof obj.toJSON === 'function' && arguments.length === 1) {
	    return hasBinary(obj.toJSON(), true);
	  }

	  for (var key in obj) {
	    if (Object.prototype.hasOwnProperty.call(obj, key) && hasBinary(obj[key])) {
	      return true;
	    }
	  }

	  return false;
	}


/***/ },
/* 11 */
/***/ function(module, exports) {

	var toString = {}.toString;

	module.exports = Array.isArray || function (arr) {
	  return toString.call(arr) == '[object Array]';
	};


/***/ },
/* 12 */
/***/ function(module, exports) {

	/**
	 * An abstraction for slicing an arraybuffer even when
	 * ArrayBuffer.prototype.slice is not supported
	 *
	 * @api public
	 */

	module.exports = function(arraybuffer, start, end) {
	  var bytes = arraybuffer.byteLength;
	  start = start || 0;
	  end = end || bytes;

	  if (arraybuffer.slice) { return arraybuffer.slice(start, end); }

	  if (start < 0) { start += bytes; }
	  if (end < 0) { end += bytes; }
	  if (end > bytes) { end = bytes; }

	  if (start >= bytes || start >= end || bytes === 0) {
	    return new ArrayBuffer(0);
	  }

	  var abv = new Uint8Array(arraybuffer);
	  var result = new Uint8Array(end - start);
	  for (var i = start, ii = 0; i < end; i++, ii++) {
	    result[ii] = abv[i];
	  }
	  return result.buffer;
	};


/***/ },
/* 13 */
/***/ function(module, exports) {

	module.exports = after

	function after(count, callback, err_cb) {
	    var bail = false
	    err_cb = err_cb || noop
	    proxy.count = count

	    return (count === 0) ? callback() : proxy

	    function proxy(err, result) {
	        if (proxy.count <= 0) {
	            throw new Error('after called too many times')
	        }
	        --proxy.count

	        // after first error, rest are passed to err_cb
	        if (err) {
	            bail = true
	            callback(err)
	            // future error callbacks will go to error handler
	            callback = err_cb
	        } else if (proxy.count === 0 && !bail) {
	            callback(null, result)
	        }
	    }
	}

	function noop() {}


/***/ },
/* 14 */
/***/ function(module, exports) {

	/*! https://mths.be/utf8js v2.1.2 by @mathias */

	var stringFromCharCode = String.fromCharCode;

	// Taken from https://mths.be/punycode
	function ucs2decode(string) {
		var output = [];
		var counter = 0;
		var length = string.length;
		var value;
		var extra;
		while (counter < length) {
			value = string.charCodeAt(counter++);
			if (value >= 0xD800 && value <= 0xDBFF && counter < length) {
				// high surrogate, and there is a next character
				extra = string.charCodeAt(counter++);
				if ((extra & 0xFC00) == 0xDC00) { // low surrogate
					output.push(((value & 0x3FF) << 10) + (extra & 0x3FF) + 0x10000);
				} else {
					// unmatched surrogate; only append this code unit, in case the next
					// code unit is the high surrogate of a surrogate pair
					output.push(value);
					counter--;
				}
			} else {
				output.push(value);
			}
		}
		return output;
	}

	// Taken from https://mths.be/punycode
	function ucs2encode(array) {
		var length = array.length;
		var index = -1;
		var value;
		var output = '';
		while (++index < length) {
			value = array[index];
			if (value > 0xFFFF) {
				value -= 0x10000;
				output += stringFromCharCode(value >>> 10 & 0x3FF | 0xD800);
				value = 0xDC00 | value & 0x3FF;
			}
			output += stringFromCharCode(value);
		}
		return output;
	}

	function checkScalarValue(codePoint, strict) {
		if (codePoint >= 0xD800 && codePoint <= 0xDFFF) {
			if (strict) {
				throw Error(
					'Lone surrogate U+' + codePoint.toString(16).toUpperCase() +
					' is not a scalar value'
				);
			}
			return false;
		}
		return true;
	}
	/*--------------------------------------------------------------------------*/

	function createByte(codePoint, shift) {
		return stringFromCharCode(((codePoint >> shift) & 0x3F) | 0x80);
	}

	function encodeCodePoint(codePoint, strict) {
		if ((codePoint & 0xFFFFFF80) == 0) { // 1-byte sequence
			return stringFromCharCode(codePoint);
		}
		var symbol = '';
		if ((codePoint & 0xFFFFF800) == 0) { // 2-byte sequence
			symbol = stringFromCharCode(((codePoint >> 6) & 0x1F) | 0xC0);
		}
		else if ((codePoint & 0xFFFF0000) == 0) { // 3-byte sequence
			if (!checkScalarValue(codePoint, strict)) {
				codePoint = 0xFFFD;
			}
			symbol = stringFromCharCode(((codePoint >> 12) & 0x0F) | 0xE0);
			symbol += createByte(codePoint, 6);
		}
		else if ((codePoint & 0xFFE00000) == 0) { // 4-byte sequence
			symbol = stringFromCharCode(((codePoint >> 18) & 0x07) | 0xF0);
			symbol += createByte(codePoint, 12);
			symbol += createByte(codePoint, 6);
		}
		symbol += stringFromCharCode((codePoint & 0x3F) | 0x80);
		return symbol;
	}

	function utf8encode(string, opts) {
		opts = opts || {};
		var strict = false !== opts.strict;

		var codePoints = ucs2decode(string);
		var length = codePoints.length;
		var index = -1;
		var codePoint;
		var byteString = '';
		while (++index < length) {
			codePoint = codePoints[index];
			byteString += encodeCodePoint(codePoint, strict);
		}
		return byteString;
	}

	/*--------------------------------------------------------------------------*/

	function readContinuationByte() {
		if (byteIndex >= byteCount) {
			throw Error('Invalid byte index');
		}

		var continuationByte = byteArray[byteIndex] & 0xFF;
		byteIndex++;

		if ((continuationByte & 0xC0) == 0x80) {
			return continuationByte & 0x3F;
		}

		// If we end up here, it’s not a continuation byte
		throw Error('Invalid continuation byte');
	}

	function decodeSymbol(strict) {
		var byte1;
		var byte2;
		var byte3;
		var byte4;
		var codePoint;

		if (byteIndex > byteCount) {
			throw Error('Invalid byte index');
		}

		if (byteIndex == byteCount) {
			return false;
		}

		// Read first byte
		byte1 = byteArray[byteIndex] & 0xFF;
		byteIndex++;

		// 1-byte sequence (no continuation bytes)
		if ((byte1 & 0x80) == 0) {
			return byte1;
		}

		// 2-byte sequence
		if ((byte1 & 0xE0) == 0xC0) {
			byte2 = readContinuationByte();
			codePoint = ((byte1 & 0x1F) << 6) | byte2;
			if (codePoint >= 0x80) {
				return codePoint;
			} else {
				throw Error('Invalid continuation byte');
			}
		}

		// 3-byte sequence (may include unpaired surrogates)
		if ((byte1 & 0xF0) == 0xE0) {
			byte2 = readContinuationByte();
			byte3 = readContinuationByte();
			codePoint = ((byte1 & 0x0F) << 12) | (byte2 << 6) | byte3;
			if (codePoint >= 0x0800) {
				return checkScalarValue(codePoint, strict) ? codePoint : 0xFFFD;
			} else {
				throw Error('Invalid continuation byte');
			}
		}

		// 4-byte sequence
		if ((byte1 & 0xF8) == 0xF0) {
			byte2 = readContinuationByte();
			byte3 = readContinuationByte();
			byte4 = readContinuationByte();
			codePoint = ((byte1 & 0x07) << 0x12) | (byte2 << 0x0C) |
				(byte3 << 0x06) | byte4;
			if (codePoint >= 0x010000 && codePoint <= 0x10FFFF) {
				return codePoint;
			}
		}

		throw Error('Invalid UTF-8 detected');
	}

	var byteArray;
	var byteCount;
	var byteIndex;
	function utf8decode(byteString, opts) {
		opts = opts || {};
		var strict = false !== opts.strict;

		byteArray = ucs2decode(byteString);
		byteCount = byteArray.length;
		byteIndex = 0;
		var codePoints = [];
		var tmp;
		while ((tmp = decodeSymbol(strict)) !== false) {
			codePoints.push(tmp);
		}
		return ucs2encode(codePoints);
	}

	module.exports = {
		version: '2.1.2',
		encode: utf8encode,
		decode: utf8decode
	};


/***/ },
/* 15 */
/***/ function(module, exports) {

	/*
	 * base64-arraybuffer
	 * https://github.com/niklasvh/base64-arraybuffer
	 *
	 * Copyright (c) 2012 Niklas von Hertzen
	 * Licensed under the MIT license.
	 */
	(function(){
	  "use strict";

	  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

	  // Use a lookup table to find the index.
	  var lookup = new Uint8Array(256);
	  for (var i = 0; i < chars.length; i++) {
	    lookup[chars.charCodeAt(i)] = i;
	  }

	  exports.encode = function(arraybuffer) {
	    var bytes = new Uint8Array(arraybuffer),
	    i, len = bytes.length, base64 = "";

	    for (i = 0; i < len; i+=3) {
	      base64 += chars[bytes[i] >> 2];
	      base64 += chars[((bytes[i] & 3) << 4) | (bytes[i + 1] >> 4)];
	      base64 += chars[((bytes[i + 1] & 15) << 2) | (bytes[i + 2] >> 6)];
	      base64 += chars[bytes[i + 2] & 63];
	    }

	    if ((len % 3) === 2) {
	      base64 = base64.substring(0, base64.length - 1) + "=";
	    } else if (len % 3 === 1) {
	      base64 = base64.substring(0, base64.length - 2) + "==";
	    }

	    return base64;
	  };

	  exports.decode =  function(base64) {
	    var bufferLength = base64.length * 0.75,
	    len = base64.length, i, p = 0,
	    encoded1, encoded2, encoded3, encoded4;

	    if (base64[base64.length - 1] === "=") {
	      bufferLength--;
	      if (base64[base64.length - 2] === "=") {
	        bufferLength--;
	      }
	    }

	    var arraybuffer = new ArrayBuffer(bufferLength),
	    bytes = new Uint8Array(arraybuffer);

	    for (i = 0; i < len; i+=4) {
	      encoded1 = lookup[base64.charCodeAt(i)];
	      encoded2 = lookup[base64.charCodeAt(i+1)];
	      encoded3 = lookup[base64.charCodeAt(i+2)];
	      encoded4 = lookup[base64.charCodeAt(i+3)];

	      bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
	      bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
	      bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
	    }

	    return arraybuffer;
	  };
	})();


/***/ },
/* 16 */
/***/ function(module, exports) {

	/**
	 * Create a blob builder even when vendor prefixes exist
	 */

	var BlobBuilder = typeof BlobBuilder !== 'undefined' ? BlobBuilder :
	  typeof WebKitBlobBuilder !== 'undefined' ? WebKitBlobBuilder :
	  typeof MSBlobBuilder !== 'undefined' ? MSBlobBuilder :
	  typeof MozBlobBuilder !== 'undefined' ? MozBlobBuilder : 
	  false;

	/**
	 * Check if Blob constructor is supported
	 */

	var blobSupported = (function() {
	  try {
	    var a = new Blob(['hi']);
	    return a.size === 2;
	  } catch(e) {
	    return false;
	  }
	})();

	/**
	 * Check if Blob constructor supports ArrayBufferViews
	 * Fails in Safari 6, so we need to map to ArrayBuffers there.
	 */

	var blobSupportsArrayBufferView = blobSupported && (function() {
	  try {
	    var b = new Blob([new Uint8Array([1,2])]);
	    return b.size === 2;
	  } catch(e) {
	    return false;
	  }
	})();

	/**
	 * Check if BlobBuilder is supported
	 */

	var blobBuilderSupported = BlobBuilder
	  && BlobBuilder.prototype.append
	  && BlobBuilder.prototype.getBlob;

	/**
	 * Helper function that maps ArrayBufferViews to ArrayBuffers
	 * Used by BlobBuilder constructor and old browsers that didn't
	 * support it in the Blob constructor.
	 */

	function mapArrayBufferViews(ary) {
	  return ary.map(function(chunk) {
	    if (chunk.buffer instanceof ArrayBuffer) {
	      var buf = chunk.buffer;

	      // if this is a subarray, make a copy so we only
	      // include the subarray region from the underlying buffer
	      if (chunk.byteLength !== buf.byteLength) {
	        var copy = new Uint8Array(chunk.byteLength);
	        copy.set(new Uint8Array(buf, chunk.byteOffset, chunk.byteLength));
	        buf = copy.buffer;
	      }

	      return buf;
	    }

	    return chunk;
	  });
	}

	function BlobBuilderConstructor(ary, options) {
	  options = options || {};

	  var bb = new BlobBuilder();
	  mapArrayBufferViews(ary).forEach(function(part) {
	    bb.append(part);
	  });

	  return (options.type) ? bb.getBlob(options.type) : bb.getBlob();
	};

	function BlobConstructor(ary, options) {
	  return new Blob(mapArrayBufferViews(ary), options || {});
	};

	if (typeof Blob !== 'undefined') {
	  BlobBuilderConstructor.prototype = Blob.prototype;
	  BlobConstructor.prototype = Blob.prototype;
	}

	module.exports = (function() {
	  if (blobSupported) {
	    return blobSupportsArrayBufferView ? Blob : BlobConstructor;
	  } else if (blobBuilderSupported) {
	    return BlobBuilderConstructor;
	  } else {
	    return undefined;
	  }
	})();


/***/ },
/* 17 */
/***/ function(module, exports, __webpack_require__) {

	
	/**
	 * Expose `Emitter`.
	 */

	if (true) {
	  module.exports = Emitter;
	}

	/**
	 * Initialize a new `Emitter`.
	 *
	 * @api public
	 */

	function Emitter(obj) {
	  if (obj) return mixin(obj);
	};

	/**
	 * Mixin the emitter properties.
	 *
	 * @param {Object} obj
	 * @return {Object}
	 * @api private
	 */

	function mixin(obj) {
	  for (var key in Emitter.prototype) {
	    obj[key] = Emitter.prototype[key];
	  }
	  return obj;
	}

	/**
	 * Listen on the given `event` with `fn`.
	 *
	 * @param {String} event
	 * @param {Function} fn
	 * @return {Emitter}
	 * @api public
	 */

	Emitter.prototype.on =
	Emitter.prototype.addEventListener = function(event, fn){
	  this._callbacks = this._callbacks || {};
	  (this._callbacks['$' + event] = this._callbacks['$' + event] || [])
	    .push(fn);
	  return this;
	};

	/**
	 * Adds an `event` listener that will be invoked a single
	 * time then automatically removed.
	 *
	 * @param {String} event
	 * @param {Function} fn
	 * @return {Emitter}
	 * @api public
	 */

	Emitter.prototype.once = function(event, fn){
	  function on() {
	    this.off(event, on);
	    fn.apply(this, arguments);
	  }

	  on.fn = fn;
	  this.on(event, on);
	  return this;
	};

	/**
	 * Remove the given callback for `event` or all
	 * registered callbacks.
	 *
	 * @param {String} event
	 * @param {Function} fn
	 * @return {Emitter}
	 * @api public
	 */

	Emitter.prototype.off =
	Emitter.prototype.removeListener =
	Emitter.prototype.removeAllListeners =
	Emitter.prototype.removeEventListener = function(event, fn){
	  this._callbacks = this._callbacks || {};

	  // all
	  if (0 == arguments.length) {
	    this._callbacks = {};
	    return this;
	  }

	  // specific event
	  var callbacks = this._callbacks['$' + event];
	  if (!callbacks) return this;

	  // remove all handlers
	  if (1 == arguments.length) {
	    delete this._callbacks['$' + event];
	    return this;
	  }

	  // remove specific handler
	  var cb;
	  for (var i = 0; i < callbacks.length; i++) {
	    cb = callbacks[i];
	    if (cb === fn || cb.fn === fn) {
	      callbacks.splice(i, 1);
	      break;
	    }
	  }
	  return this;
	};

	/**
	 * Emit `event` with the given args.
	 *
	 * @param {String} event
	 * @param {Mixed} ...
	 * @return {Emitter}
	 */

	Emitter.prototype.emit = function(event){
	  this._callbacks = this._callbacks || {};
	  var args = [].slice.call(arguments, 1)
	    , callbacks = this._callbacks['$' + event];

	  if (callbacks) {
	    callbacks = callbacks.slice(0);
	    for (var i = 0, len = callbacks.length; i < len; ++i) {
	      callbacks[i].apply(this, args);
	    }
	  }

	  return this;
	};

	/**
	 * Return array of callbacks for `event`.
	 *
	 * @param {String} event
	 * @return {Array}
	 * @api public
	 */

	Emitter.prototype.listeners = function(event){
	  this._callbacks = this._callbacks || {};
	  return this._callbacks['$' + event] || [];
	};

	/**
	 * Check if this emitter has `event` handlers.
	 *
	 * @param {String} event
	 * @return {Boolean}
	 * @api public
	 */

	Emitter.prototype.hasListeners = function(event){
	  return !! this.listeners(event).length;
	};


/***/ },
/* 18 */
/***/ function(module, exports) {

	/**
	 * Compiles a querystring
	 * Returns string representation of the object
	 *
	 * @param {Object}
	 * @api private
	 */

	exports.encode = function (obj) {
	  var str = '';

	  for (var i in obj) {
	    if (obj.hasOwnProperty(i)) {
	      if (str.length) str += '&';
	      str += encodeURIComponent(i) + '=' + encodeURIComponent(obj[i]);
	    }
	  }

	  return str;
	};

	/**
	 * Parses a simple querystring into an object
	 *
	 * @param {String} qs
	 * @api private
	 */

	exports.decode = function(qs){
	  var qry = {};
	  var pairs = qs.split('&');
	  for (var i = 0, l = pairs.length; i < l; i++) {
	    var pair = pairs[i].split('=');
	    qry[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1]);
	  }
	  return qry;
	};


/***/ },
/* 19 */
/***/ function(module, exports) {

	
	module.exports = function(a, b){
	  var fn = function(){};
	  fn.prototype = b.prototype;
	  a.prototype = new fn;
	  a.prototype.constructor = a;
	};

/***/ },
/* 20 */
/***/ function(module, exports) {

	'use strict';

	var alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_'.split('')
	  , length = 64
	  , map = {}
	  , seed = 0
	  , i = 0
	  , prev;

	/**
	 * Return a string representing the specified number.
	 *
	 * @param {Number} num The number to convert.
	 * @returns {String} The string representation of the number.
	 * @api public
	 */
	function encode(num) {
	  var encoded = '';

	  do {
	    encoded = alphabet[num % length] + encoded;
	    num = Math.floor(num / length);
	  } while (num > 0);

	  return encoded;
	}

	/**
	 * Return the integer value specified by the given string.
	 *
	 * @param {String} str The string to convert.
	 * @returns {Number} The integer value represented by the string.
	 * @api public
	 */
	function decode(str) {
	  var decoded = 0;

	  for (i = 0; i < str.length; i++) {
	    decoded = decoded * length + map[str.charAt(i)];
	  }

	  return decoded;
	}

	/**
	 * Yeast: A tiny growing id generator.
	 *
	 * @returns {String} A unique id.
	 * @api public
	 */
	function yeast() {
	  var now = encode(+new Date());

	  if (now !== prev) return seed = 0, prev = now;
	  return now +'.'+ encode(seed++);
	}

	//
	// Map each character to its index.
	//
	for (; i < length; i++) map[alphabet[i]] = i;

	//
	// Expose the `yeast`, `encode` and `decode` functions.
	//
	yeast.encode = encode;
	yeast.decode = decode;
	module.exports = yeast;


/***/ },
/* 21 */
/***/ function(module, exports, __webpack_require__) {

	/* WEBPACK VAR INJECTION */(function(process) {'use strict';

	var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

	/* eslint-env browser */

	/**
	 * This is the web browser implementation of `debug()`.
	 */

	exports.log = log;
	exports.formatArgs = formatArgs;
	exports.save = save;
	exports.load = load;
	exports.useColors = useColors;
	exports.storage = localstorage();

	/**
	 * Colors.
	 */

	exports.colors = ['#0000CC', '#0000FF', '#0033CC', '#0033FF', '#0066CC', '#0066FF', '#0099CC', '#0099FF', '#00CC00', '#00CC33', '#00CC66', '#00CC99', '#00CCCC', '#00CCFF', '#3300CC', '#3300FF', '#3333CC', '#3333FF', '#3366CC', '#3366FF', '#3399CC', '#3399FF', '#33CC00', '#33CC33', '#33CC66', '#33CC99', '#33CCCC', '#33CCFF', '#6600CC', '#6600FF', '#6633CC', '#6633FF', '#66CC00', '#66CC33', '#9900CC', '#9900FF', '#9933CC', '#9933FF', '#99CC00', '#99CC33', '#CC0000', '#CC0033', '#CC0066', '#CC0099', '#CC00CC', '#CC00FF', '#CC3300', '#CC3333', '#CC3366', '#CC3399', '#CC33CC', '#CC33FF', '#CC6600', '#CC6633', '#CC9900', '#CC9933', '#CCCC00', '#CCCC33', '#FF0000', '#FF0033', '#FF0066', '#FF0099', '#FF00CC', '#FF00FF', '#FF3300', '#FF3333', '#FF3366', '#FF3399', '#FF33CC', '#FF33FF', '#FF6600', '#FF6633', '#FF9900', '#FF9933', '#FFCC00', '#FFCC33'];

	/**
	 * Currently only WebKit-based Web Inspectors, Firefox >= v31,
	 * and the Firebug extension (any Firefox version) are known
	 * to support "%c" CSS customizations.
	 *
	 * TODO: add a `localStorage` variable to explicitly enable/disable colors
	 */

	// eslint-disable-next-line complexity
	function useColors() {
		// NB: In an Electron preload script, document will be defined but not fully
		// initialized. Since we know we're in Chrome, we'll just detect this case
		// explicitly
		if (typeof window !== 'undefined' && window.process && (window.process.type === 'renderer' || window.process.__nwjs)) {
			return true;
		}

		// Internet Explorer and Edge do not support colors.
		if (typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.toLowerCase().match(/(edge|trident)\/(\d+)/)) {
			return false;
		}

		// Is webkit? http://stackoverflow.com/a/16459606/376773
		// document is undefined in react-native: https://github.com/facebook/react-native/pull/1632
		return typeof document !== 'undefined' && document.documentElement && document.documentElement.style && document.documentElement.style.WebkitAppearance ||
		// Is firebug? http://stackoverflow.com/a/398120/376773
		typeof window !== 'undefined' && window.console && (window.console.firebug || window.console.exception && window.console.table) ||
		// Is firefox >= v31?
		// https://developer.mozilla.org/en-US/docs/Tools/Web_Console#Styling_messages
		typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/) && parseInt(RegExp.$1, 10) >= 31 ||
		// Double check webkit in userAgent just in case we are in a worker
		typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.toLowerCase().match(/applewebkit\/(\d+)/);
	}

	/**
	 * Colorize log arguments if enabled.
	 *
	 * @api public
	 */

	function formatArgs(args) {
		args[0] = (this.useColors ? '%c' : '') + this.namespace + (this.useColors ? ' %c' : ' ') + args[0] + (this.useColors ? '%c ' : ' ') + '+' + module.exports.humanize(this.diff);

		if (!this.useColors) {
			return;
		}

		var c = 'color: ' + this.color;
		args.splice(1, 0, c, 'color: inherit');

		// The final "%c" is somewhat tricky, because there could be other
		// arguments passed either before or after the %c, so we need to
		// figure out the correct index to insert the CSS into
		var index = 0;
		var lastC = 0;
		args[0].replace(/%[a-zA-Z%]/g, function (match) {
			if (match === '%%') {
				return;
			}
			index++;
			if (match === '%c') {
				// We only are interested in the *last* %c
				// (the user may have provided their own)
				lastC = index;
			}
		});

		args.splice(lastC, 0, c);
	}

	/**
	 * Invokes `console.log()` when available.
	 * No-op when `console.log` is not a "function".
	 *
	 * @api public
	 */
	function log() {
		var _console;

		// This hackery is required for IE8/9, where
		// the `console.log` function doesn't have 'apply'
		return (typeof console === 'undefined' ? 'undefined' : _typeof(console)) === 'object' && console.log && (_console = console).log.apply(_console, arguments);
	}

	/**
	 * Save `namespaces`.
	 *
	 * @param {String} namespaces
	 * @api private
	 */
	function save(namespaces) {
		try {
			if (namespaces) {
				exports.storage.setItem('debug', namespaces);
			} else {
				exports.storage.removeItem('debug');
			}
		} catch (error) {
			// Swallow
			// XXX (@Qix-) should we be logging these?
		}
	}

	/**
	 * Load `namespaces`.
	 *
	 * @return {String} returns the previously persisted debug modes
	 * @api private
	 */
	function load() {
		var r = void 0;
		try {
			r = exports.storage.getItem('debug');
		} catch (error) {}
		// Swallow
		// XXX (@Qix-) should we be logging these?


		// If debug isn't set in LS, and we're in Electron, try to load $DEBUG
		if (!r && typeof process !== 'undefined' && 'env' in process) {
			r = process.env.DEBUG;
		}

		return r;
	}

	/**
	 * Localstorage attempts to return the localstorage.
	 *
	 * This is necessary because safari throws
	 * when a user disables cookies/localstorage
	 * and you attempt to access it.
	 *
	 * @return {LocalStorage}
	 * @api private
	 */

	function localstorage() {
		try {
			// TVMLKit (Apple TV JS Runtime) does not have a window object, just localStorage in the global context
			// The Browser also has localStorage in the global context.
			return localStorage;
		} catch (error) {
			// Swallow
			// XXX (@Qix-) should we be logging these?
		}
	}

	module.exports = __webpack_require__(23)(exports);

	var formatters = module.exports.formatters;

	/**
	 * Map %j to `JSON.stringify()`, since no Web Inspectors do that by default.
	 */

	formatters.j = function (v) {
		try {
			return JSON.stringify(v);
		} catch (error) {
			return '[UnexpectedJSONParseError]: ' + error.message;
		}
	};
	/* WEBPACK VAR INJECTION */}.call(exports, __webpack_require__(22)))

/***/ },
/* 22 */
/***/ function(module, exports) {

	// shim for using process in browser
	var process = module.exports = {};

	// cached from whatever global is present so that test runners that stub it
	// don't break things.  But we need to wrap it in a try catch in case it is
	// wrapped in strict mode code which doesn't define any globals.  It's inside a
	// function because try/catches deoptimize in certain engines.

	var cachedSetTimeout;
	var cachedClearTimeout;

	function defaultSetTimout() {
	    throw new Error('setTimeout has not been defined');
	}
	function defaultClearTimeout () {
	    throw new Error('clearTimeout has not been defined');
	}
	(function () {
	    try {
	        if (typeof setTimeout === 'function') {
	            cachedSetTimeout = setTimeout;
	        } else {
	            cachedSetTimeout = defaultSetTimout;
	        }
	    } catch (e) {
	        cachedSetTimeout = defaultSetTimout;
	    }
	    try {
	        if (typeof clearTimeout === 'function') {
	            cachedClearTimeout = clearTimeout;
	        } else {
	            cachedClearTimeout = defaultClearTimeout;
	        }
	    } catch (e) {
	        cachedClearTimeout = defaultClearTimeout;
	    }
	} ())
	function runTimeout(fun) {
	    if (cachedSetTimeout === setTimeout) {
	        //normal enviroments in sane situations
	        return setTimeout(fun, 0);
	    }
	    // if setTimeout wasn't available but was latter defined
	    if ((cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) && setTimeout) {
	        cachedSetTimeout = setTimeout;
	        return setTimeout(fun, 0);
	    }
	    try {
	        // when when somebody has screwed with setTimeout but no I.E. maddness
	        return cachedSetTimeout(fun, 0);
	    } catch(e){
	        try {
	            // When we are in I.E. but the script has been evaled so I.E. doesn't trust the global object when called normally
	            return cachedSetTimeout.call(null, fun, 0);
	        } catch(e){
	            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error
	            return cachedSetTimeout.call(this, fun, 0);
	        }
	    }


	}
	function runClearTimeout(marker) {
	    if (cachedClearTimeout === clearTimeout) {
	        //normal enviroments in sane situations
	        return clearTimeout(marker);
	    }
	    // if clearTimeout wasn't available but was latter defined
	    if ((cachedClearTimeout === defaultClearTimeout || !cachedClearTimeout) && clearTimeout) {
	        cachedClearTimeout = clearTimeout;
	        return clearTimeout(marker);
	    }
	    try {
	        // when when somebody has screwed with setTimeout but no I.E. maddness
	        return cachedClearTimeout(marker);
	    } catch (e){
	        try {
	            // When we are in I.E. but the script has been evaled so I.E. doesn't  trust the global object when called normally
	            return cachedClearTimeout.call(null, marker);
	        } catch (e){
	            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error.
	            // Some versions of I.E. have different rules for clearTimeout vs setTimeout
	            return cachedClearTimeout.call(this, marker);
	        }
	    }



	}
	var queue = [];
	var draining = false;
	var currentQueue;
	var queueIndex = -1;

	function cleanUpNextTick() {
	    if (!draining || !currentQueue) {
	        return;
	    }
	    draining = false;
	    if (currentQueue.length) {
	        queue = currentQueue.concat(queue);
	    } else {
	        queueIndex = -1;
	    }
	    if (queue.length) {
	        drainQueue();
	    }
	}

	function drainQueue() {
	    if (draining) {
	        return;
	    }
	    var timeout = runTimeout(cleanUpNextTick);
	    draining = true;

	    var len = queue.length;
	    while(len) {
	        currentQueue = queue;
	        queue = [];
	        while (++queueIndex < len) {
	            if (currentQueue) {
	                currentQueue[queueIndex].run();
	            }
	        }
	        queueIndex = -1;
	        len = queue.length;
	    }
	    currentQueue = null;
	    draining = false;
	    runClearTimeout(timeout);
	}

	process.nextTick = function (fun) {
	    var args = new Array(arguments.length - 1);
	    if (arguments.length > 1) {
	        for (var i = 1; i < arguments.length; i++) {
	            args[i - 1] = arguments[i];
	        }
	    }
	    queue.push(new Item(fun, args));
	    if (queue.length === 1 && !draining) {
	        runTimeout(drainQueue);
	    }
	};

	// v8 likes predictible objects
	function Item(fun, array) {
	    this.fun = fun;
	    this.array = array;
	}
	Item.prototype.run = function () {
	    this.fun.apply(null, this.array);
	};
	process.title = 'browser';
	process.browser = true;
	process.env = {};
	process.argv = [];
	process.version = ''; // empty string to avoid regexp issues
	process.versions = {};

	function noop() {}

	process.on = noop;
	process.addListener = noop;
	process.once = noop;
	process.off = noop;
	process.removeListener = noop;
	process.removeAllListeners = noop;
	process.emit = noop;
	process.prependListener = noop;
	process.prependOnceListener = noop;

	process.listeners = function (name) { return [] }

	process.binding = function (name) {
	    throw new Error('process.binding is not supported');
	};

	process.cwd = function () { return '/' };
	process.chdir = function (dir) {
	    throw new Error('process.chdir is not supported');
	};
	process.umask = function() { return 0; };


/***/ },
/* 23 */
/***/ function(module, exports, __webpack_require__) {

	'use strict';

	function _toConsumableArray(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) { arr2[i] = arr[i]; } return arr2; } else { return Array.from(arr); } }

	/**
	 * This is the common logic for both the Node.js and web browser
	 * implementations of `debug()`.
	 */

	function setup(env) {
		createDebug.debug = createDebug;
		createDebug.default = createDebug;
		createDebug.coerce = coerce;
		createDebug.disable = disable;
		createDebug.enable = enable;
		createDebug.enabled = enabled;
		createDebug.humanize = __webpack_require__(24);

		Object.keys(env).forEach(function (key) {
			createDebug[key] = env[key];
		});

		/**
	 * Active `debug` instances.
	 */
		createDebug.instances = [];

		/**
	 * The currently active debug mode names, and names to skip.
	 */

		createDebug.names = [];
		createDebug.skips = [];

		/**
	 * Map of special "%n" handling functions, for the debug "format" argument.
	 *
	 * Valid key names are a single, lower or upper-case letter, i.e. "n" and "N".
	 */
		createDebug.formatters = {};

		/**
	 * Selects a color for a debug namespace
	 * @param {String} namespace The namespace string for the for the debug instance to be colored
	 * @return {Number|String} An ANSI color code for the given namespace
	 * @api private
	 */
		function selectColor(namespace) {
			var hash = 0;

			for (var i = 0; i < namespace.length; i++) {
				hash = (hash << 5) - hash + namespace.charCodeAt(i);
				hash |= 0; // Convert to 32bit integer
			}

			return createDebug.colors[Math.abs(hash) % createDebug.colors.length];
		}
		createDebug.selectColor = selectColor;

		/**
	 * Create a debugger with the given `namespace`.
	 *
	 * @param {String} namespace
	 * @return {Function}
	 * @api public
	 */
		function createDebug(namespace) {
			var prevTime = void 0;

			function debug() {
				for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
					args[_key] = arguments[_key];
				}

				// Disabled?
				if (!debug.enabled) {
					return;
				}

				var self = debug;

				// Set `diff` timestamp
				var curr = Number(new Date());
				var ms = curr - (prevTime || curr);
				self.diff = ms;
				self.prev = prevTime;
				self.curr = curr;
				prevTime = curr;

				args[0] = createDebug.coerce(args[0]);

				if (typeof args[0] !== 'string') {
					// Anything else let's inspect with %O
					args.unshift('%O');
				}

				// Apply any `formatters` transformations
				var index = 0;
				args[0] = args[0].replace(/%([a-zA-Z%])/g, function (match, format) {
					// If we encounter an escaped % then don't increase the array index
					if (match === '%%') {
						return match;
					}
					index++;
					var formatter = createDebug.formatters[format];
					if (typeof formatter === 'function') {
						var val = args[index];
						match = formatter.call(self, val);

						// Now we need to remove `args[index]` since it's inlined in the `format`
						args.splice(index, 1);
						index--;
					}
					return match;
				});

				// Apply env-specific formatting (colors, etc.)
				createDebug.formatArgs.call(self, args);

				var logFn = self.log || createDebug.log;
				logFn.apply(self, args);
			}

			debug.namespace = namespace;
			debug.enabled = createDebug.enabled(namespace);
			debug.useColors = createDebug.useColors();
			debug.color = selectColor(namespace);
			debug.destroy = destroy;
			debug.extend = extend;
			// Debug.formatArgs = formatArgs;
			// debug.rawLog = rawLog;

			// env-specific initialization logic for debug instances
			if (typeof createDebug.init === 'function') {
				createDebug.init(debug);
			}

			createDebug.instances.push(debug);

			return debug;
		}

		function destroy() {
			var index = createDebug.instances.indexOf(this);
			if (index !== -1) {
				createDebug.instances.splice(index, 1);
				return true;
			}
			return false;
		}

		function extend(namespace, delimiter) {
			var newDebug = createDebug(this.namespace + (typeof delimiter === 'undefined' ? ':' : delimiter) + namespace);
			newDebug.log = this.log;
			return newDebug;
		}

		/**
	 * Enables a debug mode by namespaces. This can include modes
	 * separated by a colon and wildcards.
	 *
	 * @param {String} namespaces
	 * @api public
	 */
		function enable(namespaces) {
			createDebug.save(namespaces);

			createDebug.names = [];
			createDebug.skips = [];

			var i = void 0;
			var split = (typeof namespaces === 'string' ? namespaces : '').split(/[\s,]+/);
			var len = split.length;

			for (i = 0; i < len; i++) {
				if (!split[i]) {
					// ignore empty strings
					continue;
				}

				namespaces = split[i].replace(/\*/g, '.*?');

				if (namespaces[0] === '-') {
					createDebug.skips.push(new RegExp('^' + namespaces.substr(1) + '$'));
				} else {
					createDebug.names.push(new RegExp('^' + namespaces + '$'));
				}
			}

			for (i = 0; i < createDebug.instances.length; i++) {
				var instance = createDebug.instances[i];
				instance.enabled = createDebug.enabled(instance.namespace);
			}
		}

		/**
	 * Disable debug output.
	 *
	 * @return {String} namespaces
	 * @api public
	 */
		function disable() {
			var namespaces = [].concat(_toConsumableArray(createDebug.names.map(toNamespace)), _toConsumableArray(createDebug.skips.map(toNamespace).map(function (namespace) {
				return '-' + namespace;
			}))).join(',');
			createDebug.enable('');
			return namespaces;
		}

		/**
	 * Returns true if the given mode name is enabled, false otherwise.
	 *
	 * @param {String} name
	 * @return {Boolean}
	 * @api public
	 */
		function enabled(name) {
			if (name[name.length - 1] === '*') {
				return true;
			}

			var i = void 0;
			var len = void 0;

			for (i = 0, len = createDebug.skips.length; i < len; i++) {
				if (createDebug.skips[i].test(name)) {
					return false;
				}
			}

			for (i = 0, len = createDebug.names.length; i < len; i++) {
				if (createDebug.names[i].test(name)) {
					return true;
				}
			}

			return false;
		}

		/**
	 * Convert regexp to namespace
	 *
	 * @param {RegExp} regxep
	 * @return {String} namespace
	 * @api private
	 */
		function toNamespace(regexp) {
			return regexp.toString().substring(2, regexp.toString().length - 2).replace(/\.\*\?$/, '*');
		}

		/**
	 * Coerce `val`.
	 *
	 * @param {Mixed} val
	 * @return {Mixed}
	 * @api private
	 */
		function coerce(val) {
			if (val instanceof Error) {
				return val.stack || val.message;
			}
			return val;
		}

		createDebug.enable(createDebug.load());

		return createDebug;
	}

	module.exports = setup;

/***/ },
/* 24 */
/***/ function(module, exports) {

	/**
	 * Helpers.
	 */

	var s = 1000;
	var m = s * 60;
	var h = m * 60;
	var d = h * 24;
	var w = d * 7;
	var y = d * 365.25;

	/**
	 * Parse or format the given `val`.
	 *
	 * Options:
	 *
	 *  - `long` verbose formatting [false]
	 *
	 * @param {String|Number} val
	 * @param {Object} [options]
	 * @throws {Error} throw an error if val is not a non-empty string or a number
	 * @return {String|Number}
	 * @api public
	 */

	module.exports = function(val, options) {
	  options = options || {};
	  var type = typeof val;
	  if (type === 'string' && val.length > 0) {
	    return parse(val);
	  } else if (type === 'number' && isFinite(val)) {
	    return options.long ? fmtLong(val) : fmtShort(val);
	  }
	  throw new Error(
	    'val is not a non-empty string or a valid number. val=' +
	      JSON.stringify(val)
	  );
	};

	/**
	 * Parse the given `str` and return milliseconds.
	 *
	 * @param {String} str
	 * @return {Number}
	 * @api private
	 */

	function parse(str) {
	  str = String(str);
	  if (str.length > 100) {
	    return;
	  }
	  var match = /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(
	    str
	  );
	  if (!match) {
	    return;
	  }
	  var n = parseFloat(match[1]);
	  var type = (match[2] || 'ms').toLowerCase();
	  switch (type) {
	    case 'years':
	    case 'year':
	    case 'yrs':
	    case 'yr':
	    case 'y':
	      return n * y;
	    case 'weeks':
	    case 'week':
	    case 'w':
	      return n * w;
	    case 'days':
	    case 'day':
	    case 'd':
	      return n * d;
	    case 'hours':
	    case 'hour':
	    case 'hrs':
	    case 'hr':
	    case 'h':
	      return n * h;
	    case 'minutes':
	    case 'minute':
	    case 'mins':
	    case 'min':
	    case 'm':
	      return n * m;
	    case 'seconds':
	    case 'second':
	    case 'secs':
	    case 'sec':
	    case 's':
	      return n * s;
	    case 'milliseconds':
	    case 'millisecond':
	    case 'msecs':
	    case 'msec':
	    case 'ms':
	      return n;
	    default:
	      return undefined;
	  }
	}

	/**
	 * Short format for `ms`.
	 *
	 * @param {Number} ms
	 * @return {String}
	 * @api private
	 */

	function fmtShort(ms) {
	  var msAbs = Math.abs(ms);
	  if (msAbs >= d) {
	    return Math.round(ms / d) + 'd';
	  }
	  if (msAbs >= h) {
	    return Math.round(ms / h) + 'h';
	  }
	  if (msAbs >= m) {
	    return Math.round(ms / m) + 'm';
	  }
	  if (msAbs >= s) {
	    return Math.round(ms / s) + 's';
	  }
	  return ms + 'ms';
	}

	/**
	 * Long format for `ms`.
	 *
	 * @param {Number} ms
	 * @return {String}
	 * @api private
	 */

	function fmtLong(ms) {
	  var msAbs = Math.abs(ms);
	  if (msAbs >= d) {
	    return plural(ms, msAbs, d, 'day');
	  }
	  if (msAbs >= h) {
	    return plural(ms, msAbs, h, 'hour');
	  }
	  if (msAbs >= m) {
	    return plural(ms, msAbs, m, 'minute');
	  }
	  if (msAbs >= s) {
	    return plural(ms, msAbs, s, 'second');
	  }
	  return ms + ' ms';
	}

	/**
	 * Pluralization helper.
	 */

	function plural(ms, msAbs, n, name) {
	  var isPlural = msAbs >= n * 1.5;
	  return Math.round(ms / n) + ' ' + name + (isPlural ? 's' : '');
	}


/***/ },
/* 25 */
/***/ function(module, exports, __webpack_require__) {

	/* WEBPACK VAR INJECTION */(function(global) {/**
	 * Module requirements.
	 */

	var Polling = __webpack_require__(6);
	var inherit = __webpack_require__(19);

	/**
	 * Module exports.
	 */

	module.exports = JSONPPolling;

	/**
	 * Cached regular expressions.
	 */

	var rNewline = /\n/g;
	var rEscapedNewline = /\\n/g;

	/**
	 * Global JSONP callbacks.
	 */

	var callbacks;

	/**
	 * Noop.
	 */

	function empty () { }

	/**
	 * Until https://github.com/tc39/proposal-global is shipped.
	 */
	function glob () {
	  return typeof self !== 'undefined' ? self
	      : typeof window !== 'undefined' ? window
	      : typeof global !== 'undefined' ? global : {};
	}

	/**
	 * JSONP Polling constructor.
	 *
	 * @param {Object} opts.
	 * @api public
	 */

	function JSONPPolling (opts) {
	  Polling.call(this, opts);

	  this.query = this.query || {};

	  // define global callbacks array if not present
	  // we do this here (lazily) to avoid unneeded global pollution
	  if (!callbacks) {
	    // we need to consider multiple engines in the same page
	    var global = glob();
	    callbacks = global.___eio = (global.___eio || []);
	  }

	  // callback identifier
	  this.index = callbacks.length;

	  // add callback to jsonp global
	  var self = this;
	  callbacks.push(function (msg) {
	    self.onData(msg);
	  });

	  // append to query string
	  this.query.j = this.index;

	  // prevent spurious errors from being emitted when the window is unloaded
	  if (typeof addEventListener === 'function') {
	    addEventListener('beforeunload', function () {
	      if (self.script) self.script.onerror = empty;
	    }, false);
	  }
	}

	/**
	 * Inherits from Polling.
	 */

	inherit(JSONPPolling, Polling);

	/*
	 * JSONP only supports binary as base64 encoded strings
	 */

	JSONPPolling.prototype.supportsBinary = false;

	/**
	 * Closes the socket.
	 *
	 * @api private
	 */

	JSONPPolling.prototype.doClose = function () {
	  if (this.script) {
	    this.script.parentNode.removeChild(this.script);
	    this.script = null;
	  }

	  if (this.form) {
	    this.form.parentNode.removeChild(this.form);
	    this.form = null;
	    this.iframe = null;
	  }

	  Polling.prototype.doClose.call(this);
	};

	/**
	 * Starts a poll cycle.
	 *
	 * @api private
	 */

	JSONPPolling.prototype.doPoll = function () {
	  var self = this;
	  var script = document.createElement('script');

	  if (this.script) {
	    this.script.parentNode.removeChild(this.script);
	    this.script = null;
	  }

	  script.async = true;
	  script.src = this.uri();
	  script.onerror = function (e) {
	    self.onError('jsonp poll error', e);
	  };

	  var insertAt = document.getElementsByTagName('script')[0];
	  if (insertAt) {
	    insertAt.parentNode.insertBefore(script, insertAt);
	  } else {
	    (document.head || document.body).appendChild(script);
	  }
	  this.script = script;

	  var isUAgecko = 'undefined' !== typeof navigator && /gecko/i.test(navigator.userAgent);

	  if (isUAgecko) {
	    setTimeout(function () {
	      var iframe = document.createElement('iframe');
	      document.body.appendChild(iframe);
	      document.body.removeChild(iframe);
	    }, 100);
	  }
	};

	/**
	 * Writes with a hidden iframe.
	 *
	 * @param {String} data to send
	 * @param {Function} called upon flush.
	 * @api private
	 */

	JSONPPolling.prototype.doWrite = function (data, fn) {
	  var self = this;

	  if (!this.form) {
	    var form = document.createElement('form');
	    var area = document.createElement('textarea');
	    var id = this.iframeId = 'eio_iframe_' + this.index;
	    var iframe;

	    form.className = 'socketio';
	    form.style.position = 'absolute';
	    form.style.top = '-1000px';
	    form.style.left = '-1000px';
	    form.target = id;
	    form.method = 'POST';
	    form.setAttribute('accept-charset', 'utf-8');
	    area.name = 'd';
	    form.appendChild(area);
	    document.body.appendChild(form);

	    this.form = form;
	    this.area = area;
	  }

	  this.form.action = this.uri();

	  function complete () {
	    initIframe();
	    fn();
	  }

	  function initIframe () {
	    if (self.iframe) {
	      try {
	        self.form.removeChild(self.iframe);
	      } catch (e) {
	        self.onError('jsonp polling iframe removal error', e);
	      }
	    }

	    try {
	      // ie6 dynamic iframes with target="" support (thanks Chris Lambacher)
	      var html = '<iframe src="javascript:0" name="' + self.iframeId + '">';
	      iframe = document.createElement(html);
	    } catch (e) {
	      iframe = document.createElement('iframe');
	      iframe.name = self.iframeId;
	      iframe.src = 'javascript:0';
	    }

	    iframe.id = self.iframeId;

	    self.form.appendChild(iframe);
	    self.iframe = iframe;
	  }

	  initIframe();

	  // escape \n to prevent it from being converted into \r\n by some UAs
	  // double escaping is required for escaped new lines because unescaping of new lines can be done safely on server-side
	  data = data.replace(rEscapedNewline, '\\\n');
	  this.area.value = data.replace(rNewline, '\\n');

	  try {
	    this.form.submit();
	  } catch (e) {}

	  if (this.iframe.attachEvent) {
	    this.iframe.onreadystatechange = function () {
	      if (self.iframe.readyState === 'complete') {
	        complete();
	      }
	    };
	  } else {
	    this.iframe.onload = complete;
	  }
	};

	/* WEBPACK VAR INJECTION */}.call(exports, (function() { return this; }())))

/***/ },
/* 26 */
/***/ function(module, exports, __webpack_require__) {

	/**
	 * Module dependencies.
	 */

	var Transport = __webpack_require__(7);
	var parser = __webpack_require__(8);
	var parseqs = __webpack_require__(18);
	var inherit = __webpack_require__(19);
	var yeast = __webpack_require__(20);
	var debug = __webpack_require__(21)('engine.io-client:websocket');

	var BrowserWebSocket, NodeWebSocket;

	if (typeof WebSocket !== 'undefined') {
	  BrowserWebSocket = WebSocket;
	} else if (typeof self !== 'undefined') {
	  BrowserWebSocket = self.WebSocket || self.MozWebSocket;
	}

	if (typeof window === 'undefined') {
	  try {
	    NodeWebSocket = __webpack_require__(27);
	  } catch (e) { }
	}

	/**
	 * Get either the `WebSocket` or `MozWebSocket` globals
	 * in the browser or try to resolve WebSocket-compatible
	 * interface exposed by `ws` for Node-like environment.
	 */

	var WebSocketImpl = BrowserWebSocket || NodeWebSocket;

	/**
	 * Module exports.
	 */

	module.exports = WS;

	/**
	 * WebSocket transport constructor.
	 *
	 * @api {Object} connection options
	 * @api public
	 */

	function WS (opts) {
	  var forceBase64 = (opts && opts.forceBase64);
	  if (forceBase64) {
	    this.supportsBinary = false;
	  }
	  this.perMessageDeflate = opts.perMessageDeflate;
	  this.usingBrowserWebSocket = BrowserWebSocket && !opts.forceNode;
	  this.protocols = opts.protocols;
	  if (!this.usingBrowserWebSocket) {
	    WebSocketImpl = NodeWebSocket;
	  }
	  Transport.call(this, opts);
	}

	/**
	 * Inherits from Transport.
	 */

	inherit(WS, Transport);

	/**
	 * Transport name.
	 *
	 * @api public
	 */

	WS.prototype.name = 'websocket';

	/*
	 * WebSockets support binary
	 */

	WS.prototype.supportsBinary = true;

	/**
	 * Opens socket.
	 *
	 * @api private
	 */

	WS.prototype.doOpen = function () {
	  if (!this.check()) {
	    // let probe timeout
	    return;
	  }

	  var uri = this.uri();
	  var protocols = this.protocols;
	  var opts = {
	    agent: this.agent,
	    perMessageDeflate: this.perMessageDeflate
	  };

	  // SSL options for Node.js client
	  opts.pfx = this.pfx;
	  opts.key = this.key;
	  opts.passphrase = this.passphrase;
	  opts.cert = this.cert;
	  opts.ca = this.ca;
	  opts.ciphers = this.ciphers;
	  opts.rejectUnauthorized = this.rejectUnauthorized;
	  if (this.extraHeaders) {
	    opts.headers = this.extraHeaders;
	  }
	  if (this.localAddress) {
	    opts.localAddress = this.localAddress;
	  }

	  try {
	    this.ws =
	      this.usingBrowserWebSocket && !this.isReactNative
	        ? protocols
	          ? new WebSocketImpl(uri, protocols)
	          : new WebSocketImpl(uri)
	        : new WebSocketImpl(uri, protocols, opts);
	  } catch (err) {
	    return this.emit('error', err);
	  }

	  if (this.ws.binaryType === undefined) {
	    this.supportsBinary = false;
	  }

	  if (this.ws.supports && this.ws.supports.binary) {
	    this.supportsBinary = true;
	    this.ws.binaryType = 'nodebuffer';
	  } else {
	    this.ws.binaryType = 'arraybuffer';
	  }

	  this.addEventListeners();
	};

	/**
	 * Adds event listeners to the socket
	 *
	 * @api private
	 */

	WS.prototype.addEventListeners = function () {
	  var self = this;

	  this.ws.onopen = function () {
	    self.onOpen();
	  };
	  this.ws.onclose = function () {
	    self.onClose();
	  };
	  this.ws.onmessage = function (ev) {
	    self.onData(ev.data);
	  };
	  this.ws.onerror = function (e) {
	    self.onError('websocket error', e);
	  };
	};

	/**
	 * Writes data to socket.
	 *
	 * @param {Array} array of packets.
	 * @api private
	 */

	WS.prototype.write = function (packets) {
	  var self = this;
	  this.writable = false;

	  // encodePacket efficient as it uses WS framing
	  // no need for encodePayload
	  var total = packets.length;
	  for (var i = 0, l = total; i < l; i++) {
	    (function (packet) {
	      parser.encodePacket(packet, self.supportsBinary, function (data) {
	        if (!self.usingBrowserWebSocket) {
	          // always create a new object (GH-437)
	          var opts = {};
	          if (packet.options) {
	            opts.compress = packet.options.compress;
	          }

	          if (self.perMessageDeflate) {
	            var len = 'string' === typeof data ? Buffer.byteLength(data) : data.length;
	            if (len < self.perMessageDeflate.threshold) {
	              opts.compress = false;
	            }
	          }
	        }

	        // Sometimes the websocket has already been closed but the browser didn't
	        // have a chance of informing us about it yet, in that case send will
	        // throw an error
	        try {
	          if (self.usingBrowserWebSocket) {
	            // TypeError is thrown when passing the second argument on Safari
	            self.ws.send(data);
	          } else {
	            self.ws.send(data, opts);
	          }
	        } catch (e) {
	          debug('websocket closed before onclose event');
	        }

	        --total || done();
	      });
	    })(packets[i]);
	  }

	  function done () {
	    self.emit('flush');

	    // fake drain
	    // defer to next tick to allow Socket to clear writeBuffer
	    setTimeout(function () {
	      self.writable = true;
	      self.emit('drain');
	    }, 0);
	  }
	};

	/**
	 * Called upon close
	 *
	 * @api private
	 */

	WS.prototype.onClose = function () {
	  Transport.prototype.onClose.call(this);
	};

	/**
	 * Closes socket.
	 *
	 * @api private
	 */

	WS.prototype.doClose = function () {
	  if (typeof this.ws !== 'undefined') {
	    this.ws.close();
	  }
	};

	/**
	 * Generates uri for connection.
	 *
	 * @api private
	 */

	WS.prototype.uri = function () {
	  var query = this.query || {};
	  var schema = this.secure ? 'wss' : 'ws';
	  var port = '';

	  // avoid port if default for schema
	  if (this.port && (('wss' === schema && Number(this.port) !== 443) ||
	    ('ws' === schema && Number(this.port) !== 80))) {
	    port = ':' + this.port;
	  }

	  // append timestamp to URI
	  if (this.timestampRequests) {
	    query[this.timestampParam] = yeast();
	  }

	  // communicate binary support capabilities
	  if (!this.supportsBinary) {
	    query.b64 = 1;
	  }

	  query = parseqs.encode(query);

	  // prepend ? to query
	  if (query.length) {
	    query = '?' + query;
	  }

	  var ipv6 = this.hostname.indexOf(':') !== -1;
	  return schema + '://' + (ipv6 ? '[' + this.hostname + ']' : this.hostname) + port + this.path + query;
	};

	/**
	 * Feature detection for WebSocket.
	 *
	 * @return {Boolean} whether this transport is available.
	 * @api public
	 */

	WS.prototype.check = function () {
	  return !!WebSocketImpl && !('__initialize' in WebSocketImpl && this.name === WS.prototype.name);
	};


/***/ },
/* 27 */
/***/ function(module, exports) {

	/* (ignored) */

/***/ },
/* 28 */
/***/ function(module, exports) {

	
	var indexOf = [].indexOf;

	module.exports = function(arr, obj){
	  if (indexOf) return arr.indexOf(obj);
	  for (var i = 0; i < arr.length; ++i) {
	    if (arr[i] === obj) return i;
	  }
	  return -1;
	};

/***/ },
/* 29 */
/***/ function(module, exports) {

	/**
	 * Parses an URI
	 *
	 * @author Steven Levithan <stevenlevithan.com> (MIT license)
	 * @api private
	 */

	var re = /^(?:(?![^:@]+:[^:@\/]*@)(http|https|ws|wss):\/\/)?((?:(([^:@]*)(?::([^:@]*))?)?@)?((?:[a-f0-9]{0,4}:){2,7}[a-f0-9]{0,4}|[^:\/?#]*)(?::(\d*))?)(((\/(?:[^?#](?![^?#\/]*\.[^?#\/.]+(?:[?#]|$)))*\/?)?([^?#\/]*))(?:\?([^#]*))?(?:#(.*))?)/;

	var parts = [
	    'source', 'protocol', 'authority', 'userInfo', 'user', 'password', 'host', 'port', 'relative', 'path', 'directory', 'file', 'query', 'anchor'
	];

	module.exports = function parseuri(str) {
	    var src = str,
	        b = str.indexOf('['),
	        e = str.indexOf(']');

	    if (b != -1 && e != -1) {
	        str = str.substring(0, b) + str.substring(b, e).replace(/:/g, ';') + str.substring(e, str.length);
	    }

	    var m = re.exec(str || ''),
	        uri = {},
	        i = 14;

	    while (i--) {
	        uri[parts[i]] = m[i] || '';
	    }

	    if (b != -1 && e != -1) {
	        uri.source = src;
	        uri.host = uri.host.substring(1, uri.host.length - 1).replace(/;/g, ':');
	        uri.authority = uri.authority.replace('[', '').replace(']', '').replace(/;/g, ':');
	        uri.ipv6uri = true;
	    }

	    return uri;
	};


/***/ }
/******/ ])
});
;
define('gina/link', [ 'require', 'jquery', 'vendor/uuid','utils/merge', 'utils/events' ], function (require) {

    var $       = require('jquery');
    $.noConflict();
    var uuid    = require('vendor/uuid');
    var merge   = require('utils/merge');

    require('utils/events'); // events
    
    /**
     * Gina Link Handler
     *
     * @param {object} options
     * */
    function Link(options) {

        this.plugin = 'link';

        var events  = ['loaded', 'ready', 'open', 'close', 'destroy', 'success', 'error', 'progress'];
        registerEvents(this.plugin, events);

        var self = { // local use only
            'options' : {
                'url' : undefined,
                'class': 'gina-link-default'
            },
            authorizedEvents : ['ready', 'success', 'error'],
            events: {}
        };

        var instance        = {
            plugin          : this.plugin,
            id              : 'gina-links-' + uuid.v4(),
            on              : on,
            eventData       : {},

            '$links'       : {},
            target          : document, // by default
            isReady         : false,
            initialized     : false
        };

        // link proto
        var $link          = { // is on main `gina-links` container (first level)
            'plugin'            : this.plugin,
            'on'                : on,
            'eventData'         : {},
            'target'            : document, // by default

            'url'               : null,
            'request'           : null,
            '$forms'            : []
        };



        // XML Request
        var xhr = null;
        
        /**
         * XML Request options
         * */
        var xhrOptions = {
            'url'           : '',
            'method'        : 'GET',
            'isSynchrone'   : false,
            'withCredentials': true, // if should be enabled under a trusted env
            'headers'       : {
                // cross domain is enabled by default, but you need to setup `Access-Control-Allow-Origin`
                'X-Requested-With': 'XMLHttpRequest' // to set isXMLRequest == true && in case of cross domain origin

            }
        };

        var registeredLinks = [];

        

        var proxyClick = function($childNode, $el, evt) {

            addListener(gina, $childNode, 'click', function(e) {
                cancelEvent(e);

                triggerEvent(gina, $el, evt);
            });
        }
        
        var getLinkById = function(id) {            
            return ( typeof(instance.$links[id]) != 'undefined' ) ? instance.$links[id] : null;
        }
        
        var getLinkByUrl = function(url) {
            var $link = null;
            
            for (var p in gina.link.$links) {
                if ( typeof(gina.link.$links[p].url) != 'undefined' && gina.link.$links[p].url == url ) {
                    $link = gina.link.$links[p];
                    break;
                }
            }
            
            return $link;
        }
        
                  

        /**
         * linkRequest
         *
         * @param {string} url
         * @param {object} [options]
         * */
        function linkRequest(url, options) {

            // link object
            var $link      = getLinkByUrl(url);
            var id         = $link.id;
            
            
            // link element
            var $el         = document.getElementById(id) || null;
            
            var hLinkIsRequired = null;        
            // forward callback to HTML data event attribute through `hform` status
            hLinkIsRequired = ( $el.getAttribute('data-gina-link-event-on-success') || $el.getAttribute('data-gina-link-event-on-error') ) ? true : false;
            // success -> data-gina-form-event-on-submit-success
            // error -> data-gina-form-event-on-submit-error
            if (hLinkIsRequired)
                listenToXhrEvents($link);

            // if ( $el == null ) {

            //     //var className   = $link.options.class +' '+ id;
            //     $el             = document.createElement('a');
            //     $el.setAttribute('id', id);
            //     //$el.setAttribute('class', className);
            //     instance.target.firstChild.appendChild($el);
            // }

            if ( typeof(options) == 'undefined' ) {
                options = xhrOptions;
            } else {
                options = merge(options, xhrOptions);
            }
            
            if ( /^(http|https)\:/.test(url) && !new RegExp('^' + window.location.protocol + '//'+ window.location.host).test(url) ) {
                // is request from same domain ?
                //options.headers['Origin']   = window.protocol+'//'+window.location.host;
                //options.headers['Origin']   = '*';
                //options.headers['Host']     = 'https://freelancer-app.fr.local:3154';
                var isSameDomain = ( new RegExp(window.location.hostname).test(url) ) ? true : false;
                if (!isSameDomain) {
                    // proxy external urls
                    // TODO - instead of using `cors.io`, try to intégrate a local CORS proxy similar to : http://oskarhane.com/avoid-cors-with-nginx-proxy_pass/
                    //url = url.match(/^(https|http)\:/)[0] + '//cors.io/?' + url;
                    url = url.match(/^(https|http)\:/)[0] + '//corsacme.herokuapp.com/?'+ url;
                    //delete options.headers['X-Requested-With']
                }   
            }
            options.url     = url;
            // updating link options
            if ($link && typeof($link.options) != 'undefined')
                options  = merge($link.options, options);


            if ( options.withCredentials ) { // Preflighted requests               
                if ('withCredentials' in xhr) {
                    // XHR for Chrome/Firefox/Opera/Safari.
                    if (options.isSynchrone) {
                        xhr.open(options.method, options.url, options.isSynchrone)
                    } else {
                        xhr.open(options.method, options.url)
                    }
                } else if ( typeof XDomainRequest != 'undefined' ) {
                    // XDomainRequest for IE.
                    xhr = new XDomainRequest();
                    xhr.open(options.method, options.url);
                } else {
                    // CORS not supported.
                    xhr = null;
                    var result = 'CORS not supported: the server is missing the header `"Access-Control-Allow-Credentials": true` ';
                    triggerEvent(gina, $el, 'error.' + id, result)
                }
            } else { // simple requests
                
                if (options.isSynchrone) {
                    xhr.open(options.method, options.url, options.isSynchrone)
                } else {
                    xhr.open(options.method, options.url)
                }
            }

            

            if (!xhr)
                throw new Error('No `xhr` object initiated');
            
            
            options.$link = $link;
            //xhr = handleXhr(xhr, $el, options);
            handleXhr(xhr, $el, options, require);
            // sending
            xhr.send();
        }

        // var listenToXhrEvents = function($link) {
            
        //     //data-gina-link-event-on-success
        //     var htmlSuccesEventCallback =  $link.target.getAttribute('data-gina-link-event-on-success') || null;
        //     if (htmlSuccesEventCallback != null) {
    
        //         if ( /\((.*)\)/.test(htmlSuccesEventCallback) ) {
        //             eval(htmlSuccesEventCallback)
        //         } else {
        //             $link.on('success.hlink',  window[htmlSuccesEventCallback])
        //         }
        //     }
    
        //     //data-gina-link-event-on-error
        //     var htmlErrorEventCallback =  $link.target.getAttribute('data-gina-link-event-on-error') || null;
        //     if (htmlErrorEventCallback != null) {
        //         if ( /\((.*)\)/.test(htmlErrorEventCallback) ) {
        //             eval(htmlErrorEventCallback)
        //         } else {
        //             $link.on('error.hlink', window[htmlErrorEventCallback])
        //         }
        //     }
        // }
        
        

        
        function registerLink($link, options) {
            
            if ( typeof(options) != 'object' ) {
                throw new Error('`options` must be an object')
            }
            
            $link.options = merge(options, self.options);         
            
            // link element
            var id  = $link.id;
            var $el = document.getElementById(id) || null;
            
            if ( typeof(instance.$links[$link.id]) == 'undefined' ) {               

                

                if ( registeredLinks.indexOf($link.id) > -1 ) {
                    throw new Error('`link '+$link.id+'` already exists !')
                }
                
                
                if (!gina.events[evt]) {
                    
                    
                
                    // attach click events
                    addListener(gina, $el, evt, function(e) {
                        cancelEvent(e);

                        var $localLink = getLinkById(e.target.id)
                        // loading & binding link     
                        var localUrl = $localLink.url;

                        // Non-Preflighted requests                        
                        if ( typeof($localLink.options.isSynchrone) == 'undefined' ) {
                            $localLink.options.isSynchrone = false;
                        }
                        if ( typeof($localLink.options.withCredentials) == 'undefined' ) {
                            $localLink.options.withCredentials = false
                        }
                                              
                        linkRequest(localUrl, $localLink.options);                                 
                        
                        //delete gina.events[ $localLink.id ];
                        //removeListener(gina, event.target, event.type)
                    });



                    // bind child elements
                    var childNodes = $el.childNodes;
                    var l = 0; lLen = childNodes.length;
                    if (lLen > 0) {
                        for(; l < lLen; ++l) {
                            if (typeof (childNodes[l].tagName) != 'undefined') {
                                proxyClick(childNodes[l], $el, evt)
                            }
                        }
                    }
                }
                
                

                                        
                $link.request       = linkRequest;
                $link.getLinkById   = getLinkById;
                $link.getLinkByUrl  = getLinkByUrl;
                
                instance.$links[$link.id] = $link;
                
                
                             
            }
        }
        
        /**
         * bindLinks
         *
         * @param {object} $target - DOM element
         * @param {object} [options]
         * */
        var bindLinks = function($target, options) {
            
            var id = null;
            if ( typeof($target) == 'undefined' ) {
                $target = instance.target;
                id = instance.id;
            }
            
            // binding form elements
            var found               = null
                , $el               = null
                , props             = null
                , $newLink          = null
                , url               = null
                , elId              = null
                , onEvent           = null
                , onclickAttribute  = null
                // a
                , $a                = $target.getElementsByTagName('a')
                // buttons
                //, $button   = $target.getElementsByTagName('button')
            ;
            
            var i = 0, len = $a.length;            
            for (; i < len; ++i) {
                found = $a[i].getAttribute('data-gina-link');
                
                if (!found) continue;
                
                $el     = $a[i];
                props   = {
                    type: 'a',
                    method: 'GET'
                };
                
                
                url = $el.getAttribute('data-gina-link-url');
                if ( typeof(url) != 'undefined' && url != null ) {
                    props.url = url
                } else {
                    props.url = $el.getAttribute('href')
                }
                
                               
                                
                
                elId = $el.getAttribute('id');
                if ( typeof(elId) == 'undefined' || elId == null || elId == '' || /popin\.link/.test(elId) ) {
                    
                    // unbind popin link
                    // if ( /popin\.link/.test(elId) ) {
                        
                    // }
                    
                    elId = 'link.click.'+ 'gina-link-' + instance.id +'-'+ uuid.v4();
                }                
                $el['id']   = elId;
                props.id    = elId;
                evt         = elId;
                $el.setAttribute('id', evt);
                
                if ($el.tagName == 'A') {
                    onclickAttribute = $el.getAttribute('onclick');
                }

                if ( !onclickAttribute ) {
                    $el.setAttribute('onclick', 'return false;')
                } else if ( typeof(onclickAttribute) != 'undefined' && !/return false/.test(onclickAttribute) ) {
                    if ( /\;$/.test(onclickAttribute) ) {
                        onclickAttribute += 'return false;'
                    } else {
                        onclickAttribute += '; return false;'
                    }
                    $el.setAttribute('onclick', onclickAttribute);
                }
                
                $newLink = null;
                
                if ( typeof(instance.$links[props.id]) == 'undefined' ) {            
                    props.target = $el;   
                    $newLink = merge(props, $link);  
                    registerLink($newLink, options);
                }
                
                
            }
            
        }

        var init = function(options) {
            
            setupInstanceProto();
            instance.on('init', function(event) {
                
                // setting up AJAX
                if (window.XMLHttpRequest) { // Mozilla, Safari, ...
                    xhr = new XMLHttpRequest();
                } else if (window.ActiveXObject) { // IE
                    try {
                        xhr = new ActiveXObject("Msxml2.XMLHTTP");
                    } catch (e) {
                        try {
                            xhr = new ActiveXObject("Microsoft.XMLHTTP");
                        }
                        catch (e) {}
                    }
                } 
                
                // proxies
                // click on main document
                evt = 'click';// click proxy
                // for proxies, use linkInstance.id as target is always `document`
                addListener(gina, instance.target, evt, function(event) {

                    if ( typeof(event.target.id) == 'undefined' ) {
                        event.target.setAttribute('id', evt +'.'+ uuid.v4() );
                        event.target.id = event.target.getAttribute('id')
                    }

                    

                    if ( /^link\.click\./.test(event.target.id) ) {
                        cancelEvent(event);
                        var _evt = event.target.id;

                        if ( new RegExp( '^link.click.gina-link-' + instance.id).test(_evt) )
                            triggerEvent(gina, event.target, _evt, event.detail);

                    }
                });
                
                if ( typeof(options) == 'undefined' ) {
                    options = {}
                }
                instance.options = options;
                
                bindLinks(instance.target, options);
                gina.linkIsBinded = true;

                instance.isReady = true;
                gina.hasLinkHandler = true;
                gina.link = merge(gina.link, instance);
                // trigger link ready event
                triggerEvent(gina, instance.target, 'ready.' + instance.id, instance);
            });

            
                

            instance.initialized = true;

            return instance
        }
        
        var setupInstanceProto = function() {

            instance.bindLinks      = bindLinks;
            instance.request        = linkRequest;
            instance.getLinkById    = getLinkById;
            instance.getLinkByUrl   = getLinkByUrl;
        }
        
        return init(options)
    };

    return Link
});
define('gina/popin', [ 'require', 'jquery', 'vendor/uuid','utils/merge', 'utils/events' ], function (require) {

    var $       = require('jquery');
    $.noConflict();
    var uuid    = require('vendor/uuid');
    var merge   = require('utils/merge');

    require('utils/events'); // events

    /**
     * Gina Popin Handler
     *
     * @param {object} options
     * */
    function Popin(options) {

        this.plugin = 'popin';

        var events  = ['loaded', 'ready', 'open', 'close', 'destroy', 'success', 'error', 'progress'];
        registerEvents(this.plugin, events);

        var self = { // local use only
            'options' : {
                'name' : undefined,
                'class': 'gina-popin-default'
            },
            authorizedEvents : ['ready', 'error'],
            events: {}
        };

        var instance        = {
            plugin          : this.plugin,
            id              : 'gina-popins-' + uuid.v4(),
            on              : on,
            eventData       : {},

            '$popins'       : {},
            activePopinId   : null, 
            getActivePopin  : null, // returns the active $popin
            target          : document, // by default
            isReady         : false,
            initialized     : false
        };

        // popin proto
        var $popin          = { // is on main `gina-popins` container (first level)
            'plugin'            : this.plugin,
            'on'                : on,
            'eventData'         : {},
            'target'            : document, // by default

            'name'              : null,
            'load'              : null,
            'loadContent'       : null,
            'open'              : null,
            'isOpen'            : false,
            'close'             : null,
            '$forms'            : []
        };

        // imopring other plugins
        var $validatorInstance   = null; // validator instance


        // XML Request
        var xhr = null;

        var registeredPopins = [];


        /**
         * popinCreateContainer
         *
         * Creates HTML container and add it to the DOM
         *
         *
         * */
        var popinCreateContainer = function() {

            // creating template
            // <div class="gina-popins">
            //     <div class="gina-popins-overlay gina-popin-is-active"></div>
            // </div>
            var $container = document.createElement('div');
            $container.id = instance.id;
            $container.setAttribute('id', instance.id);
            $container.setAttribute('class', 'gina-popins');

            var $overlay = document.createElement('div');
            $overlay.setAttribute('id', 'gina-popins-overlay');
            $overlay.setAttribute('class', 'gina-popins-overlay');


            $container.appendChild( $overlay );

            // adding to DOM
            document.body.appendChild($container);

            instance.target     = $container;
            instance.on         = on;

            gina.popinContainer  = instance.id;
            //gina.hasPopinHandler = true;
        }
        
        var popinGetContainer = function () {
            instance.target     = document.getElementById(gina.popinContainer);
            instance.on         = on;
        }

        var proxyClick = function($childNode, $el, evt) {

            addListener(gina, $childNode, 'click', function(e) {
                cancelEvent(e);

                triggerEvent(gina, $el, evt);
            });
        }
        
        var getPopinById = function(id) {            
            return ( typeof(instance.$popins[id]) != 'undefined' ) ? instance.$popins[id] : null;
        }
        
        var getPopinByName = function(name) {
            
            var $popin = null;
            
            for (var p in instance.$popins) {
                if ( instance.$popins[p].name === name ) {
                    $popin = instance.$popins[p];
                    break;
                }
            }
            
            return $popin;
        }  
         
        function getActivePopin() {            
            var $popin = null;
            
            for (var p in gina.popin.$popins) {
                if ( typeof(gina.popin.$popins[p].isOpen) != 'undefined' && gina.popin.$popins[p].isOpen ) {
                    $popin = gina.popin.$popins[p];
                    break;
                }
            }
            
            return $popin;
        }     
        

        var bindOpen = function($popin, isRouting) {
            
            isRouting = ( typeof(isRouting) != 'undefined' ) ? isRouting : false;
            
            var attr    = 'data-gina-popin-name';
            var $els    = getElementsByAttribute(attr);
            var $el     = null, name = null;
            var url     = null;            
            var proceed = null, evt = null;
            var i = null, len = null;

            i = 0; len = $els.length;
            for (;i < len; ++i) {
                $el     = $els[i];
                name    = $el.getAttribute(attr);
                if ( $el.tagName == 'A' ) {
                    url = $el.getAttribute('href');
                    if (url == '' || url =='#' || /\#/.test(url) ) {
                        url = null
                    }
                }

                if ( !url && typeof( $el.getAttribute('data-gina-popin-url') ) != 'undefined') {
                    url = $el.getAttribute('data-gina-popin-url');

                }

                if (!url) {
                    throw new Error('Found `data-gina-popin-name` without `url` !')
                }

                if ( !$el['url'] ) {
                    $el['url'] = url;
                }

                if ( !$el['popinName'] ) {
                    $el['popinName'] = name;
                }

                if (name == $popin.name) {
                    evt = 'popin.click.'+ 'gina-popin-' + instance.id +'-'+ uuid.v4() +'-'+ name;
                    $el['id'] = evt;
                    $el.setAttribute( 'id', evt);

                    
                    if (!gina.events[evt]) {
                    
                        // attach click events
                        addListener(gina, $el, evt, function(e) {
                            cancelEvent(e);

                            var fired = false;
                            $popin.on('loaded', function (e) {
                                e.preventDefault();

                                if (!fired) {
                                    fired = true;

                                    //e.target.innerHTML = e.detail;


                                    // bind with formValidator if forms are found
                                    // if ( /<form/i.test(e.target.innerHTML) && typeof($validatorInstance) != 'undefined' ) {
                                    //     var _id = null;
                                    //     var $forms = e.target.getElementsByTagName('form');
                                    //     for (var i = 0, len = $forms.length; i < len; ++i) {

                                    //         if ( !$forms[i]['id'] || typeof($forms[i]) != 'string' ) {
                                    //             _id = $forms[i].getAttribute('id') || 'form.' + uuid.v4();
                                    //             $forms[i].setAttribute('id', _id);// just in case
                                    //             $forms[i]['id'] = _id
                                    //         } else {
                                    //             _id = $forms[i]['id']
                                    //         }

                                    //         //console.log('pushing ', _id, $forms[i]['id'], typeof($forms[i]['id']), $forms[i].getAttribute('id'));
                                    //         if ($popin['$forms'].indexOf(_id) < 0)
                                    //             $popin['$forms'].push(_id);

                                    //         $forms[i].close = popinClose;
                                    //         $validatorInstance.validateFormById($forms[i].getAttribute('id')) //$forms[i]['id']

                                    //         removeListener(gina, $popin.target, e.type);
                                    //     }
                                    // }
                                    
                                    popinBind(e, $popin);
                                    if (!$popin.isOpen) {                                        
                                        popinOpen($popin.name);
                                    }
                                        
                                }
                            });

                            // loading & binding popin       
                            // Non-Preflighted requests
                            var options = {                            
                                isSynchrone: false,
                                withCredentials: false
                            };                       
                            options = merge($popin.options, options);                       
                            popinLoad($popin.name, e.target.url, options);
                        });



                        // bind child elements
                        var childNodes = $el.childNodes;
                        var l = 0; lLen = childNodes.length;
                        if (lLen > 0) {
                            for(; l < lLen; ++l) {
                                if (typeof (childNodes[l].tagName) != 'undefined') {
                                    proxyClick(childNodes[l], $el, evt)
                                }
                            }
                        }
                    }
                }

            }

            // proxies
            // click on main document
            evt = 'click';// click proxy
            // for proxies, use popinInstance.id as target is always `document`
            addListener(gina, document, evt, function(event) {

                if ( typeof(event.target.id) == 'undefined' ) {
                    event.target.setAttribute('id', evt +'.'+ uuid.v4() );
                    event.target.id = event.target.getAttribute('id')
                }

                if ( /^popin\.close\./.test(event.target.id) ) {
                    cancelEvent(event);

                    var _evt = event.target.id;

                    triggerEvent(gina, event.target, _evt, event.detail);
                }

                if ( /^popin\.click\./.test(event.target.id) ) {
                    cancelEvent(event);
                    //console.log('popin.click !! ', event.target);
                    var _evt = event.target.id;

                    if ( new RegExp( '^popin.click.gina-popin-' + instance.id).test(_evt) )
                        triggerEvent(gina, event.target, _evt, event.detail);

                }
            });

            gina.popinIsBinded = false
        }
        
        
        function popinBind(e, $popin) {
            
            var $el = e.target;
            var eventType = e.type;
                        
            if ( typeof(e.detail) != 'undefined' )
                $el.innerHTML = e.detail.trim();
            
            var register = function (type, evt, $element) {
                // attach submit events
                addListener(gina, $element, evt, function(event) {

                    cancelEvent(event);
                    
                    if (type != 'close') {
                        
                        var fired = false;
                        var _evt = 'loaded.' + $popin.id;
                        
                        if ( typeof(gina.events[_evt]) == 'undefined' ) {
                            addListener(gina, $el, _evt, function(e) {
                            
                                e.preventDefault();

                                if (!fired) {
                                    fired = true;                                                                        
                                    popinLoadContent(e.detail);   
                                }
                            });
                        }
                        
                        // Non-Preflighted requests
                        var options = {                            
                            isSynchrone: false,
                            withCredentials: false
                        };
                        //options = merge(options, $popin.options);                        
                        options = merge($popin.options, options);   
                        popinLoad($popin.name, $element.href, options);
                    }            
                            
                    removeListener(gina, event.target, event.type)
                });
                
                addListener(gina, $element, 'click', function(event) {
                    cancelEvent(event);
                    
                    if ( type == 'link' ) {
                        
                        if ( event.target.getAttribute('target') != null && event.target.getAttribute('target') != '' ) {
                            window.open(event.target.getAttribute('href'), event.target.getAttribute('target'));
                        } else { // else, inside viewbox
                            // TODO - Integrate https://github.com/box/viewer.js#loading-a-simple-viewer
                            
                            triggerEvent(gina, event.target, event.currentTarget.id, $popin);
                        }
                        
                    } else { // close
                        
                        if ( typeof(event.target.id) == 'undefined' ) {
                            event.target.setAttribute('id', evt +'.'+ uuid.v4() );
                            event.target.id = event.target.getAttribute('id')
                        }
        
                        if ( /^popin\.close\./.test(event.target.id) ) {
                            cancelEvent(event);
        
                            popinClose($popin.name);
                        }
        
                        if ( /^popin\.click\./.test(event.target.id) ) {
                            cancelEvent(event);
                            //console.log('popin.click !! ', event.target);
                            var _evt = event.target.id;
        
                            if ( new RegExp( '^popin.click.gina-popin-' + instance.id).test(_evt) )
                                triggerEvent(gina, event.target, _evt, event.detail);
        
                        }
                    }
                    
                });
                    
            };
            
            gina.popinIsBinded = true;
            
            var i       = null
                , b     = null
                , len   = null
            ;
            // bind overlay on click
            if (!$popin.isOpen) {                         
                     
                var $overlay = instance.target.childNodes[0];
                addListener(gina, $overlay, 'click', function(event) {

                    // don't cancel here, it will corrupt child elements behaviors such as checkboxes and radio buttons
                    if ( /gina-popin-is-active/.test(event.target.className) ) {

                        // remove listeners
                        removeListener(gina, event.target, 'click');
        
                        // binding popin close
                        var $close          = []
                            , $buttonsTMP   = []                            
                        ;
                        
                        i = 0;        
                        $buttonsTMP = $el.getElementsByTagName('button');
                        b = 0; len = $buttonsTMP.length;
                        if ( len > 0 ) {
                            for(; b < len; ++b) {
                                if ( /gina-popin-close/.test($buttonsTMP[b].className) ) {
                                    $close[i] = $buttonsTMP[b];
                                    ++i
                                }   
                            }
                        }
        
                        $buttonsTMP = $el.getElementsByTagName('div');
                        b = 0; len = $buttonsTMP.length;
                        if ( len > 0 ) {
                            for(; b < len; ++b) {
                                if ( /gina-popin-close/.test($buttonsTMP[b].className) ) {
                                    $close[i] = $buttonsTMP[b];
                                    ++i
                                }                                    
                            }
                        }
        
                        $buttonsTMP = $el.getElementsByTagName('a');
                        b = 0; len = $buttonsTMP.length;
                        if ( len > 0 ) {
                            for(; b < len; ++b) {
                                if ( /gina-popin-close/.test($buttonsTMP[b].className) ) {
                                    $close[i] = $buttonsTMP[b];
                                    ++i
                                }   
                            }
                        }
        
                        b = 0; len = $close.length;
                        for (; b < len; ++b) {
                            removeListener(gina, $close[b], $close[b].getAttribute('id') )
                        }
        
                        popinClose($popin.name);
                    }
                    
                });
            }

            // bind with formValidator if forms are found
            if ( /<form/i.test($el.innerHTML) && typeof($validatorInstance) != 'undefined' && $validatorInstance ) {
                var _id = null;
                var $forms = $el.getElementsByTagName('form');
                i = 0; len = $forms.length;
                for(; i < len; ++i) {

                    if ( !$forms[i]['id'] || typeof($forms[i]) != 'string' ) {
                        _id = $forms[i].getAttribute('id') || 'form.' + uuid.v4();
                        $forms[i].setAttribute('id', _id);// just in case
                        $forms[i]['id'] = _id
                    } else {
                        _id = $forms[i]['id']
                    }

                    //console.log('pushing ', _id, $forms[i]['id'], typeof($forms[i]['id']), $forms[i].getAttribute('id'));
                    if ($popin['$forms'].indexOf(_id) < 0)
                        $popin['$forms'].push(_id);

                    $forms[i].close = popinClose;
                    $validatorInstance.validateFormById($forms[i].getAttribute('id')) //$forms[i]['id']

                    removeListener(gina, $popin.target, eventType);
                }
            }
            
            // binding popin close & links (& its target attributes)
            var $close          = []
                , $buttonsTMP   = []
                , $link         = []
            ;

            $buttonsTMP = $el.getElementsByTagName('button');
            i = 0; b = 0; len = $buttonsTMP.length;
            if ( $buttonsTMP.length > 0 ) {
                for(; b < len; ++b) {
                    if ( /gina-popin-close/.test($buttonsTMP[b].className) ) {
                        $close[i] = $buttonsTMP[b];
                        ++i
                    }                        
                }
            }

            $buttonsTMP = $el.getElementsByTagName('div');
            b = 0; len = $buttonsTMP.length;
            if ( len > 0 ) {
                for(; b < len; ++b) {
                    if ( /gina-popin-close/.test($buttonsTMP[b].className) ) {
                        $close[i] = $buttonsTMP[b];
                        ++i;
                    }                        
                }
            }

            $buttonsTMP = $el.getElementsByTagName('a');
            b = 0; len = $buttonsTMP.length;
            if ( len > 0 ) {
                for(; b < len; ++b) {
                    if ( /gina-popin-close/.test($buttonsTMP[b].className) ) {
                        $close[i] = $buttonsTMP[b];
                        ++i;
                        continue
                    }
                    
                    if ( 
                        typeof($buttonsTMP[b]) != 'undefined' 
                        && !/(\#|\#.*)$/.test($buttonsTMP[b].href) // ignore href="#"                        
                        && !$buttonsTMP[b].id // ignore href already bindded byr formValidator or the user
                    ) {
                        $link.push($buttonsTMP[b]);
                        continue
                    }
                }
            }
            
            var onclickAttribute = null, evt = null;
            // close events
            b = 0; len = $close.length;
            for (; b < len; ++b) {
                if ($close[b].tagName == 'A') {
                    onclickAttribute = $close[b].getAttribute('onclick');
                }

                if ( !onclickAttribute ) {
                    $close[b].setAttribute('onclick', 'return false;')
                } else if ( typeof(onclickAttribute) != 'undefined' && !/return false/.test(onclickAttribute) ) {
                    if ( /\;$/.test(onclickAttribute) ) {
                        onclickAttribute += 'return false;'
                    } else {
                        onclickAttribute += '; return false;'
                    }
                }

                if (!$close[b]['id']) {

                    evt = 'popin.close.'+ uuid.v4();
                    $close[b]['id'] = evt;
                    $close[b].setAttribute( 'id', evt);

                } else {
                    evt = $close[b]['id'];
                }               


                if ( typeof(gina.events[evt]) == 'undefined' || gina.events[evt] != $close[b].id ) {
                    register('close', evt, $close[b])
                }
            }
            
            // link events
            i = 0; len = $link.length;
            for(; i < len; ++i) {

                if (!$link[i]['id']) {

                    evt = 'popin.link.'+ uuid.v4();
                    $link[i]['id'] =  $link[i].getAttribute('id') || evt;
                    $link[i].setAttribute( 'id', evt);

                } else {
                    evt = $link[i]['id'];
                }
                // if is disabled, stop propagation
                if ( $link[i].getAttribute('disabled') != null ) {
                    continue;
                }

                if ( typeof(gina.events[evt]) == 'undefined' || gina.events[evt] != $link[i].id ) {
                    register('link', evt, $link[i])
                }
            }          
            
            
        }
        
        function updateToolbar(result, resultIsObject) {
            // update toolbar errors
            var $popin = getActivePopin();
            
            if ( gina && typeof(window.ginaToolbar) == 'object' && typeof(result) != 'undefined' && typeof(resultIsObject) != 'undefined' && result ) {
                
                var XHRData = result;
                
                try {                    
                    var XHRDataNew = null;
                    if ( !resultIsObject && XHRData.error && /^(\{|\[)/.test(XHRData.error) )
                        XHRData.error = JSON.parse(XHRData.error);
                    
                    // bad .. should not happen
                    if ( typeof(XHRData.error) != 'undefined' && typeof(XHRData.error) == 'object' && typeof(XHRData.error) == 'object' ) {
                        // by default
                        XHRDataNew = { 'status' : XHRData.status };
                        // existing will be overriden by user
                        for (xErr in XHRData.error) {
                            if ( !/^error$/.test(xErr ) ) {
                                XHRDataNew[xErr] = XHRData.error[xErr];
                            }
                        }

                        XHRDataNew.error = XHRData.error.error;

                        XHRData = result = XHRDataNew
                    } else if ( typeof(XHRData.error) != 'undefined' && typeof(XHRData.error) == 'string' ) {
                        XHRData = result;
                    }
                        
                    XHRData.isXHRViewData = true;
                    ginaToolbar.update('data-xhr', XHRData );
                    return;
                } catch (err) {
                    throw err
                }
            }
            
            // update toolbar
            try {
                var $popin = getPopinById(instance.activePopinId);
                var $el = $popin.target;
            } catch (err) {
                ginaToolbar.update('data-xhr', err );
            }
            
            
            // XHRData
            var XHRData = null;            
            if ( typeof(result) == 'string' && /\<(.*)\>/.test(result) ) {
                // converting Element to DOM object
                XHRData = new DOMParser().parseFromString(result, 'text/html').getElementById('gina-without-layout-xhr-data');               
            } else {
                XHRData = document.getElementById('gina-without-layout-xhr-data');
            }
            
            if ( gina && typeof(window.ginaToolbar) == 'object' && XHRData ) {
                try {

                    if ( typeof(XHRData.value) != 'undefined' && XHRData.value ) {
                        XHRData = JSON.parse( decodeURIComponent( XHRData.value ) );
                        // reset data-xhr
                        XHRData.isXHRViewData = true;
                        ginaToolbar.update('data-xhr', XHRData);
                    }

                } catch (err) {
                    throw err
                }
            }

            // XHRView
            var XHRView = null;
            if ( typeof(result) == 'string' && /\<(.*)\>/.test(result) ) {                
                // converting Element to DOM object
                XHRView = new DOMParser().parseFromString(result, 'text/html').getElementById('gina-without-layout-xhr-view');                
            } else {
                XHRView = document.getElementById('gina-without-layout-xhr-view');
            }
            
            if ( gina && typeof(window.ginaToolbar) == 'object' && XHRView ) {
                try {

                    if ( typeof(XHRView.value) != 'undefined' && XHRView.value ) {
                        
                        XHRView = JSON.parse( decodeURIComponent( XHRView.value ) );                        
                        // reset data-xhr
                        //ginaToolbar.update("view-xhr", null);
                        ginaToolbar.update('view-xhr', XHRView);
                    }

                    // popin content
                    ginaToolbar.update('el-xhr', $popin.id);

                } catch (err) {
                    throw err
                }
            }
        }



        /**
         * XML Request options
         * */
        var xhrOptions = {
            'url'           : '',
            'method'        : 'GET',
            'isSynchrone'   : false,
            'withCredentials': true, // if should be enabled under a trusted env
            'headers'       : {
                // cross domain is enabled by default, but you need to setup `Access-Control-Allow-Origin`
                'X-Requested-With': 'XMLHttpRequest' // to set isXMLRequest == true && in case of cross domain origin

            }
        };

        /**
         * popinLoad
         *
         * @param {string} name
         * @param {string} url
         * @param {object} [options]
         * */
        function popinLoad(name, url, options) {

            // popin object
            var $popin      = getPopinByName(name);
            var id          = $popin.id;
            
            
            // popin element
            var $el         = document.getElementById(id) || null;

            if ( $el == null ) {

                var className   = $popin.options.class +' '+ id;
                $el             = document.createElement('div');
                $el.setAttribute('id', id);
                $el.setAttribute('class', className);
                instance.target.firstChild.appendChild($el);
            }

            if ( typeof(options) == 'undefined' ) {
                options = xhrOptions;
            } else {
                options = merge(options, xhrOptions);
            }
            
            if ( /^(http|https)\:/.test(url) && !new RegExp('^' + window.location.protocol + '//'+ window.location.host).test(url) ) {
                // is request from same domain ?
                //options.headers['Origin']   = window.protocol+'//'+window.location.host;
                //options.headers['Origin']   = '*';
                //options.headers['Host']     = 'https://freelancer-app.fr.local:3154';
                var isSameDomain = ( new RegExp(window.location.hostname).test(url) ) ? true : false;
                if (!isSameDomain) {
                    // proxy external urls
                    // TODO - instead of using `cors.io`, try to intégrate a local CORS proxy similar to : http://oskarhane.com/avoid-cors-with-nginx-proxy_pass/
                    //url = url.match(/^(https|http)\:/)[0] + '//cors.io/?' + url;
                    url = url.match(/^(https|http)\:/)[0] + '//corsacme.herokuapp.com/?'+ url;
                    //url = url.match(/^(https|http)\:/)[0] + '//cors-anywhere.herokuapp.com/' + url;
                    //url = url.match(/^(https|http)\:/)[0] + '//cors-anywhere.herokuapp.com/' + url;
                    
                    //delete options.headers['X-Requested-With']
                }   
            }
            options.url     = url;
            // updating popin options
            $popin.options  = merge(options, $popin.options);


            if ( options.withCredentials ) { // Preflighted requests               
                if ('withCredentials' in xhr) {
                    // XHR for Chrome/Firefox/Opera/Safari.
                    if (options.isSynchrone) {
                        xhr.open(options.method, options.url, options.isSynchrone)
                    } else {
                        xhr.open(options.method, options.url)
                    }
                } else if ( typeof XDomainRequest != 'undefined' ) {
                    // XDomainRequest for IE.
                    xhr = new XDomainRequest();
                    xhr.open(options.method, options.url);
                } else {
                    // CORS not supported.
                    xhr = null;
                    var result = 'CORS not supported: the server is missing the header `"Access-Control-Allow-Credentials": true` ';
                    triggerEvent(gina, $el, 'error.' + id, result)
                }
            } else { // simple requests
                
                if (options.isSynchrone) {
                    xhr.open(options.method, options.url, options.isSynchrone)
                } else {
                    xhr.open(options.method, options.url)
                }
            }

            

            if (xhr) {
                // setting up headers
                xhr.withCredentials = ( typeof(options.withCredentials) != 'undefined' ) ? options.withCredentials : false;
                                
                xhr.onerror = function(event, err) {
                    
                    var error = 'Transaction error: might be due to the server CORS settings.\nPlease, check the console for more details.';
                    var result = {
                        'status':  xhr.status, //500,
                        'error' : error
                    };                    
                    
                    var resultIsObject = true;
                    instance.eventData.error = result +'/n'+ err;                                
                    updateToolbar(result, resultIsObject);
                    triggerEvent(gina, $el, 'error.' + id, result)
                }
                
                
                for (var header in options.headers) {
                    xhr.setRequestHeader(header, options.headers[header]);
                }
                
                
                // catching ready state cb
                xhr.onreadystatechange = function (event) {
                    if (xhr.readyState == 4) {
                        // 200, 201, 201' etc ...
                        if( /^2/.test(xhr.status) ) {

                            try {
                                var result = xhr.responseText;
                                if ( /json$/.test( xhr.getResponseHeader("Content-Type") ) ) {
                                    result = JSON.parse(xhr.responseText)
                                }
                                

                                instance.eventData.success = result;
                                
                                triggerEvent(gina, $el, 'loaded.' + id, result);
                                
                                updateToolbar(result);

                            } catch (err) {
                                
                                var resultIsObject = false;
                                
                                var result = {
                                    'status':  422,
                                    'error' : err.description || err.stack
                                };
                                
                                if ( /json$/.test( xhr.getResponseHeader("Content-Type") ) ) {
                                    result.error = JSON.parse(xhr.responseText);
                                    resultIsObject = true
                                }

                                instance.eventData.error = result;
                                
                                updateToolbar(result, resultIsObject);

                                triggerEvent(gina, $el, 'error.' + id, result)
                            }

                        } else {
                            //console.log('error event triggered ', event.target, $form);
                            var resultIsObject = false;
                            var result = {
                                'status':  xhr.status,
                                'error' : xhr.responseText
                            };

                            if ( /json$/.test( xhr.getResponseHeader("Content-Type") ) ) {
                                result.error = JSON.parse(xhr.responseText);
                                resultIsObject = true
                            }

                            instance.eventData.error = result;                            
                            

                            // update toolbar
                            updateToolbar(result, resultIsObject);
                            // var XHRData = result;
                            // if ( gina && typeof(window.ginaToolbar) == "object" && XHRData ) {
                            //     try {
                            //         if ( !resultIsObject && XHRData.error && /^(\{|\[).test(XHRData.error) /)
                            //             XHRData.error = JSON.parse(XHRData.error);

                            //         // bad .. should not happen
                            //         if ( typeof(XHRData.error) != 'undefined' && typeof(XHRData.error) == 'object' && typeof(XHRData.error) == 'object' ) {
                            //             // by default
                            //             var XHRDataNew = { 'status' : XHRData.status };
                            //             // existing will be overriden by user
                            //             for (xErr in XHRData.error) {
                            //                 if ( !/^error$/.test(xErr ) ) {
                            //                     XHRDataNew[xErr] = XHRData.error[xErr];
                            //                 }
                            //             }

                            //             XHRDataNew.error = XHRData.error.error;

                            //             XHRData = result = XHRDataNew
                            //         }
                                        
                            //         XHRData.isXHRViewData = true;
                            //         ginaToolbar.update("data-xhr", XHRData )
                            //     } catch (err) {
                            //         throw err
                            //     }
                            // }


                            triggerEvent(gina, $el, 'error.' + id, result)
                        }
                    }
                };

                // catching request progress
                // xhr.onprogress = function(event) {
                //     //console.log(
                //     //    'progress position '+ event.position,
                //     //    '\nprogress total size '+ event.totalSize
                //     //);
                //
                //     var percentComplete = (event.position / event.totalSize)*100;
                //     var result = {
                //         'status': 100,
                //         'progress': percentComplete
                //     };
                //
                //     instance.eventData.onprogress = result;
                //
                //     triggerEvent(gina, $el, 'progress.' + id, result)
                // };

                // catching timeout
                // xhr.ontimeout = function (event) {
                //     var result = {
                //         'status': 408,
                //         'error': 'Request Timeout'
                //     };
                //
                //     instance.eventData.ontimeout = result;
                //
                //     triggerEvent(gina, $el, 'error.' + id, result)
                // };


                // sending
                //var data = JSON.stringify({ sample: 'data'});
                xhr.send();
                

                return {
                    'open': function () {
                        var fired = false;
                        addListener(gina, $el, 'loaded.' + id, function(e) {
                        
                            e.preventDefault();

                            if (!fired) {
                                fired = true;
                                
                                instance.activePopinId = $popin.id;
                                popinBind(e, $popin);
                                popinOpen($popin.name);
                            }
                        });

                    }
                }
            }

        }

        /**
         * popinLoadContent
         * 
         * @param {string} html - plain/text
         * @param {object} [data] - 
         */
        function popinLoadContent(stringContent) {
            
            var $popin = getActivePopin(); 
            if ( !$popin.isOpen )
                throw new Error('Popin `'+$popin.name+'` is not open !');
            
            var $el = $popin.target;
            $el.innerHTML = stringContent.trim(); 
            popinUnbind($popin.name, true);          
            popinBind({ target: $el, type: 'loaded.' + $popin.id }, $popin);            
            
            triggerEvent(gina, instance.target, 'open.'+ $popin.id, $popin);
        }
               
        function getScript(source, callback) {
            var script = document.createElement('script');
            var prior = document.getElementsByTagName('script')[0];
            script.async = 0;
        
            script.onload = script.onreadystatechange = function( _, isAbort ) {
                if(isAbort || !script.readyState || /loaded|complete/.test(script.readyState) ) {
                    script.onload = script.onreadystatechange = null;
                    script = undefined;
        
                    if(!isAbort && callback) setTimeout(callback, 0);
                }
            };
        
            script.src = source;
            prior.parentNode.insertBefore(script, prior);
        }
        
        /**
         * popinOpen
         *
         * Opens a popin by name
         *
         * @parama {string} name
         *
         * */
        function popinOpen(name) {

            var id = null, $el = null;
            var $popin = ( typeof(name) != 'undefined') ? getPopinByName(name) : getPopinById(this.id);
            if ( !$popin ) {
                throw new Error('Popin name `'+name+'` not found !')
            } 
            id = $popin.id;
            $el = document.getElementById(id);
            
            // load external ressources
            var globalScriptsList = document.getElementsByTagName('script');
            var ignoreList  = [], s = 0;
            var i = 0, len = globalScriptsList.length;
            var scripts = $el.getElementsByTagName('script');
            // for (;i < len; ++i) {
            //     if ( !globalScriptsList[i].src || /gina(\.min\.js|\.js)$/.test(globalScriptsList[i].src) )
            //         continue;    
                    
            //     ignoreList[s] = globalScriptsList[i].src;
            //     ++s
            // }
                        
            i = 0; len = scripts.length;
            for (;i < len; ++i) {
                // don't load if already in the global context
                // if ( ignoreList.indexOf(scripts[i].src) > -1 )
                //     continue;
                
                getScript(scripts[i].src);               
            }  
            
            popinBind({ target: $el, type: 'loaded.' + $popin.id }, $popin);
                       

            if ( !/gina-popin-is-active/.test($el.className) )
                $el.className += ' gina-popin-is-active';

            // overlay
            if ( !/gina-popin-is-active/.test(instance.target.firstChild.className) )
                instance.target.firstChild.className += ' gina-popin-is-active';    
            // overlay
            if ( /gina-popin-is-active/.test(instance.target.firstChild.className) ) {
                //removeListener(gina, event.target, event.target.getAttribute('id'))
                removeListener(gina, instance.target, 'open.'+ $popin.id)
            }

            $popin.isOpen = true;
            // so it can be forwarded to the handler who is listening
            $popin.target = $el;
            
            instance.activePopinId = $popin.id;

            // update toolbar
            updateToolbar();
            // var XHRData = document.getElementById('gina-without-layout-xhr-data');
            // if ( gina && typeof(window.ginaToolbar) == "object" && XHRData ) {
            //     try {

            //         if ( typeof(XHRData.value) != 'undefined' && XHRData.value ) {
            //             XHRData = JSON.parse( decodeURIComponent( XHRData.value ) );
            //             // reset data-xhr
            //             ginaToolbar.update("data-xhr", null);
            //             XHRData.isXHRViewData = true;
            //             ginaToolbar.update("data-xhr", XHRData);
            //         }

            //     } catch (err) {
            //         throw err
            //     }
            // }

            // var XHRView = document.getElementById('gina-without-layout-xhr-view');
            // if ( gina && typeof(window.ginaToolbar) == "object" && XHRView ) {
            //     try {

            //         if ( typeof(XHRView.value) != 'undefined' && XHRView.value ) {
            //             XHRView = JSON.parse( decodeURIComponent( XHRView.value ) );
            //             // reset data-xhr
            //             ginaToolbar.update("view-xhr", null);

            //             ginaToolbar.update("view-xhr", XHRView);
            //         }

            //         // popin content
            //         ginaToolbar.update("el-xhr", id);

            //     } catch (err) {
            //         throw err
            //     }
            // }

            triggerEvent(gina, instance.target, 'open.'+ $popin.id, $popin);
        }

        /**
         * popinUnbind
         *
         * Closes a popin by `name` or all `is-active`
         *
         * @parama {string} [name]
         *
         * */
        function popinUnbind(name, isRouting) {
            
            var $popin = ( typeof(name) != 'undefined') ? getPopinByName(name) : getActivePopin();
            var $el = null;
            if ( !$popin && typeof(name) != 'undefined' ) {
                throw new Error('Popin `'+name+'` not found !');
            }
            
            // by default
            if ( typeof($popin) != 'undefined' && $popin != null ) {
                $el = $popin.target;
                
                isRouting = ( typeof(isRouting) != 'undefined' ) ? isRouting : false;

                if ( $el != null && /gina-popin-is-active/.test($el.className) ) {
                    if (!isRouting) {
                        instance.target.firstChild.className    = instance.target.firstChild.className.replace(/\sgina-popin-is-active|gina-popin-is-active|gina-popin-is-active\s/, '');
                        $el.className                           = $el.className.replace(/\sgina-popin-is-active|gina-popin-is-active|gina-popin-is-active\s/, '');
                        $el.innerHTML                           = '';
                    }                    

                    // removing from FormValidator instance
                    if ($validatorInstance) {
                        var i = 0, formsLength = $popin['$forms'].length;
                        if ($validatorInstance['$forms'] && formsLength > 0) {
                            for (; i < formsLength; ++i) {
                                if ( typeof($validatorInstance['$forms'][ $popin['$forms'][i] ]) != 'undefined' )
                                    $validatorInstance['$forms'][ $popin['$forms'][i] ].destroy();

                                $popin['$forms'].splice( i, 1);
                            }
                        }
                    }
                    
                    gina.popinIsBinded = false;
                    
                    // remove listeners
                    removeListener(gina, $popin.target, 'loaded.' + $popin.id);
                }
            }                
        }
        

        /**
         * popinClose
         *
         * Closes a popin by `name` or all `is-active`
         *
         * @parama {string} [name]
         *
         * */
        function popinClose(name) {
            
            var $popin = ( typeof(name) != 'undefined') ? getPopinByName(name) : getActivePopin();
            var $el = null;
            if ( !$popin && typeof(name) != 'undefined' ) {
               throw new Error('Popin `'+name+'` not found !');
            }
            
            // by default
            if ( typeof($popin) != 'undefined' && $popin != null ) {
                $el = $popin.target;
                
                removeListener(gina, $popin.target, 'ready.' + instance.id);
                

                if ( $el != null && /gina-popin-is-active/.test($el.className) ) {
                    
                    popinUnbind(name);            
                    $popin.isOpen           = false;
                    gina.popinIsBinded      = false;                

                    // restore toolbar
                    if ( gina && typeof(window.ginaToolbar) == "object" )
                        ginaToolbar.restore();

                    instance.activePopinId  = null;
                    triggerEvent(gina, $popin.target, 'close.'+ $popin.id, $popin);
                }
            }            
        }

        /**
         * popinDestroy
         *
         * Destroyes a popin by name
         *
         * @parama {string} name
         *
         * */
        function popinDestroy(name) {
            
            var $popin = ( typeof(name) != 'undefined') ? getPopinByName(name) : getActivePopin();
            var id = null, $el = null;
            if ( !$popin && typeof(name) != 'undefined' ) {
                throw new Error('Popin `'+name+'` not found !');
            }
            
            id = $popin.id;
        }
        
        function registerPopin($popin, options) {
            
            if ( typeof(options) != 'object' ) {
                throw new Error('`options` must be an object')
            }
            
            $popin.options = merge(options, self.options);
            $popin.id = 'gina-popin-' + instance.id +'-'+ $popin.options['name'];
            
            if ( typeof(instance.$popins[$popin.id]) == 'undefined' ) {               

                if ( typeof($popin.options['name']) != 'string' || $popin.options['name'] == '' ) {
                    throw new Error('`options.name` can not be left `empty` or `undefined`')
                }

                if ( registeredPopins.indexOf($popin.options['name']) > -1 ) {
                    throw new Error('`popin '+$popin.options['name']+'` already exists !')
                }

                // import over plugins
                if ( typeof($popin.options['validator']) != 'undefined' ) {
                    $validatorInstance = $popin.options['validator'];
                    $popin.validateFormById = $validatorInstance.validateFormById;
                }
                

                $popin.options['class'] = 'gina-popin-container ' + $popin.options['class'];

                
                $popin.name             = $popin.options['name'];        
                $popin.target           = instance.target;  
                $popin.load             = popinLoad;
                $popin.loadContent      = popinLoadContent;
                $popin.open             = popinOpen;
                $popin.close            = popinClose;
                $popin.updateToolbar    = updateToolbar;  
                
                instance.$popins[$popin.id] = $popin;

                // setting up AJAX
                if (window.XMLHttpRequest) { // Mozilla, Safari, ...
                    xhr = new XMLHttpRequest();
                } else if (window.ActiveXObject) { // IE
                    try {
                        xhr = new ActiveXObject("Msxml2.XMLHTTP");
                    } catch (e) {
                        try {
                            xhr = new ActiveXObject("Microsoft.XMLHTTP");
                        }
                        catch (e) {}
                    }
                }
                
                
                
                bindOpen($popin);                
            }
        }

        var init = function(options) {
            
            setupInstanceProto();
            instance.on('init', function(event) {
                
                var $newPopin = null;
                var popinId = 'gina-popin-' + instance.id +'-'+ options['name'];
                if ( typeof(instance.$popins[popinId]) == 'undefined' ) {               
                    var $newPopin = merge({}, $popin);  
                    registerPopin($newPopin, options);
                }

                instance.isReady = true;
                gina.hasPopinHandler = true;
                gina.popin = merge(gina.popin, instance);
                // trigger popin ready event
                triggerEvent(gina, instance.target, 'ready.' + instance.id, $newPopin);
            });

            
                

            instance.initialized = true;

            return instance
        }
        
        var setupInstanceProto = function() {

            instance.load           = popinLoad;
            instance.loadContent    = popinLoadContent;
            instance.getActivePopin = getActivePopin;
            instance.open           = popinOpen;
            instance.close          = popinClose;
        }
        

        if ( !gina.hasPopinHandler ) {
            popinCreateContainer();
        } else {
            popinGetContainer()
        }

        return init(options)
    };

    return Popin
});
/**
 * This file is part of the gina package.
 * Copyright (c) 2017 Rhinostone <gina@rhinostone.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */


/**
 * @class Inherits
 *
 * @package gina.utils
 * @namesame gina.utils.inherits
 * @author Rhinostone <gina@rhinostone.com>
 *
 * @api Public
 * */
function Inherits(a, b) {

    /**
     * init
     * @constructor
     * */
    var init = function(a, b) {
        var err = check(a, b);


        if (!err) {

            var z = (function() {
                var _inherited = false, cache = a;

                if (!_inherited) {
                    _inherited = true;

                    return function() {

                        if (this) {
                            this.prototype = cache.prototype;

                            if (!this.name) this.name = cache.name;

                            this.prototype.name = this.name;

                            //makes it compatible with node.js classes like EventEmitter
                            for (var prop in b.prototype) {
                                if (!this[prop] /**&& prop != 'instance'*/) {// all but instances
                                    this[prop] = b.prototype[prop]
                                }
                            }

                            b.apply(this, arguments);
                            cache.apply(this, arguments);
                        }
                    }
                }

            }(a, b));

            //makes it compatible with node.js classes like EventEmitter
            if (a.prototype == undefined) {
                a.prototype = {}
            }

            if (b.prototype == undefined) {
                b.prototype = {}
            }

            a.prototype = Object.create(b.prototype, {});
            z.prototype = Object.create(a.prototype, {}); //{ name: { writable: true, configurable: true, value: name }

            return z
        } else {
            throw new Error(err)
        }
    }

    var check = function(a, b) {
        if ( typeof(a) == 'undefined' || typeof(b) == 'undefined') {
            return 'inherits(a, b): neither [ a ] nor [ b ] can\'t be undefined or null'
        }
        return false
    }

    return init
};


if ( ( typeof(module) !== 'undefined' ) && module.exports ) {
    // Publish as node.js module
    module.exports = Inherits()
} else if ( typeof(define) === 'function' && define.amd) {
    // Publish as AMD module
    define( 'utils/inherits',[],function() { return Inherits() })
}
;
/**
 * Gina Frontend Framework
 *
 * Usage:
 *  By adding gina tag in the end of the DOM ( just before </body>)
 *
 *      <script type="text/javascript" src="/js/vendor/gina/gina.min.js"></script>
 *
 *  You can add or edit config options through the `data-gina-config`
 *      <script type="text/javascript" src="/js/vendor/gina/gina.min.js" data-gina-config="{ env: 'dev', envIsDev: true, webroot: '/' }"></script>
 *
 *  Through RequireJS
 *
 *      var gina = require('gina');
 *
 *  Useful Globals
 *
 *  window['originalContext']
 *      You have to passe your `jQuery` or your `DollarDom` context to Gina
 *      e.g.: 
 *          window['originalContext'] = window['jQuery']
 *
 * */

//var wContext = ( typeof(window.onGinaLoaded) == 'undefined') ? window : parent.window; // iframe case
var readyList = [ { name: 'gina', ctx: window['gina'], fn: window.onGinaLoaded } ];
var readyFired = false;
var readyEventHandlersInstalled = false;

// call this when the document is ready
// this function protects itself against being called more than once
function ready() {

    if (!readyFired) {

        // this must be set to true before we start calling callbacks
        readyFired = true;
        var result = null;
        var i = i || 0;

        var handleEvent = function (i, readyList) {

            if ( readyList[i] ) {

                if (readyList[i].name == 'gina') {

                    var scheduler = window.setInterval(function (i, readyList) {
                        try {                            
                            readyList[i].ctx = window.gina;
                            result = readyList[i].fn.call(window, readyList[i].ctx, window.require);

                            // clear
                            if (result) {
                                window.clearInterval(scheduler);
                                ++i;
                                handleEvent(i, readyList)
                            }
                        } catch (err) {
                            window.clearInterval(scheduler);
                            throw err
                        }

                    }, 50, i, readyList);


                } else { // onEachHandlerReady
                    // iframe case
                    if ( !window.$ && typeof(parent.window.$) != 'undefined' ) {
                        window.$ = parent.window.$;
                    }
                    readyList[i].ctx = window.originalContext || $;// passes the user's orignalContext by default; if no orignalContext is set will try users'jQuery
                    readyList[i].fn.call(window, readyList[i].ctx, window.require);
                    ++i;
                    handleEvent(i, readyList)
                }

            } else { // end
                // allow any closures held by these functions to free
                readyList = [];
            }
        }

        handleEvent(i, readyList)
    }
}

function readyStateChange() {
    if ( document.readyState === 'complete' ) {        
        gina.ready();
    }
}


if ( typeof(window['gina']) == 'undefined' ) {// could have be defined by loader

    var gina = {
        /**
         * ready
         * This is the one public interface use to wrap `handlers`
         * It is an equivalent of jQuery(document).ready(cb)
         *
         * No need to use it for `handlers`, it is automatically applied for each `handler`
         *
         * @callback {callback} callback
         * @param {object} [context] - if present, it will be passed
         * */
        /**@js_externs ready*/
        ready: function(callback, context) {


            // if ready has already fired, then just schedule the callback
            // to fire asynchronously, but right away
            if (readyFired) {
                setTimeout(function() {callback(context);}, 1);
                return;
            } else {
                // add the function and context to the list
                readyList.push({ name: 'anonymous', fn: callback, ctx: context });
            }

            // if document already ready to go, schedule the ready function to run
            // IE only safe when readyState is "complete", others safe when readyState is "interactive"
            if (document.readyState === "complete" || (!document.attachEvent && document.readyState === "interactive")) {
                setTimeout(ready, 1);
            } else if (!readyEventHandlersInstalled) {
                // otherwise if we don't have event handlers installed, install them
                if (document.addEventListener) {
                    // first choice is DOMContentLoaded event
                    document.addEventListener("DOMContentLoaded", ready, false);
                    // backup is window load event
                    window.addEventListener("load", ready, false);
                } else {
                    // must be IE
                    document.attachEvent("onreadystatechange", readyStateChange);
                    window.attachEvent("onload", ready);
                }
                readyEventHandlersInstalled = true;
            }

        }
    };

    window['gina'] = gina;
}


define('core', ['require', 'gina'], function (require) {
    require('gina')(window['gina']); // passing core required lib through parameters
});


require.config({
    "packages": ["gina"]
});

require([
    //vendors
    "vendor/uuid",
    "vendor/engine.io",

    "core",

    // plugins
    "gina/link",
    "gina/validator",
    "gina/popin",
    "gina/storage",

    // utils
    "utils/dom",
    "utils/events",
    "utils/inherits",
    //"utils/merge",
    "utils/form-validator",
    "utils/collection",
    "utils/routing"
]);


// catching freelancer script load event
var tags = document.getElementsByTagName('script');

for (var t = 0, len = tags.length; t < len; ++t) {

    if ( /gina.min.js|gina.js/.test( tags[t].getAttribute('src') ) ) {

        tags[t]['onload'] = function onGinaLoaded(e) {
            // TODO - get the version number from the response ?? console.log('tag ', tags[t].getAttribute('data-gina-config'));
            // var req = new XMLHttpRequest();
            // req.open('GET', document.location, false);
            // req.send(null);
            // var version = req.getAllResponseHeaders().match(/X-Powered-By:(.*)/)[0].replace('X-Powered-By: ', '');
            if (window['onGinaLoaded']) {
                var onGinaLoaded = window['onGinaLoaded']
            } else {
                function onGinaLoaded(gina) {

                    if (!gina) {
                        return false
                    } else {
                        if ( gina["isFrameworkLoaded"] ) {
                            return true
                        }

                        var options = gina['config'] = {
                            /**@js_externs env*/
                            //env     : '{{ page.environment.env }}',
                            /**@js_externs envIsDev*/
                            envIsDev : ( /^true$/.test('{{ page.environment.envIsDev }}') ) ? true : false,
                            /**@js_externs version*/
                            //version : '{{ page.environment.version }}',
                            /**@js_externs webroot*/
                            'webroot' : '{{ page.environment.webroot }}',
                        };

                       
                        // globals
                        window['GINA_ENV']          = '{{ GINA_ENV }}';
                        window['GINA_ENV_IS_DEV']   = '{{ GINA_ENV_IS_DEV }}';

                        gina["setOptions"](options);
                        gina["isFrameworkLoaded"]       = true;

                        // making adding css to the head
                        var link    = null;
                        link        = document.createElement('link');
                        link.href   = options.webroot + "css/vendor/gina/gina.min.css";
                        link.media  = "screen";
                        link.rel    = "stylesheet";
                        link.type   = "text/css";
                        document.getElementsByTagName('head')[0].appendChild(link);

                        return true
                    }
                }
            }


            if (document.addEventListener) {
                document.addEventListener("ginaloaded", function(event){
                    //console.log('Gina Framework is ready !');
                    window['gina'] = event.detail;
                    onGinaLoaded(event.detail)
                })
            } else if (document.attachEvent) {
                document.attachEvent("ginaloaded", function(event){
                    window['gina'] = event.detail;
                    onGinaLoaded(event.detail)
                })
            }
        }()
        break;
    }
};