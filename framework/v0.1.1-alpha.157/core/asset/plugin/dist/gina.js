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

!function(r,n){"object"==typeof exports&&"undefined"!=typeof module?n(exports):"function"==typeof define&&define.amd?define('vendor/uuid',["exports"],n):n((r=r||self).uuid={})}(this,(function(r){"use strict";var n="undefined"!=typeof crypto&&crypto.getRandomValues&&crypto.getRandomValues.bind(crypto)||"undefined"!=typeof msCrypto&&"function"==typeof msCrypto.getRandomValues&&msCrypto.getRandomValues.bind(msCrypto),e=new Uint8Array(16);function t(){if(!n)throw new Error("crypto.getRandomValues() not supported. See https://github.com/uuidjs/uuid#getrandomvalues-not-supported");return n(e)}for(var o,a,u=[],f=0;f<256;++f)u[f]=(f+256).toString(16).substr(1);function c(r,n){var e=n||0,t=u;return[t[r[e++]],t[r[e++]],t[r[e++]],t[r[e++]],"-",t[r[e++]],t[r[e++]],"-",t[r[e++]],t[r[e++]],"-",t[r[e++]],t[r[e++]],"-",t[r[e++]],t[r[e++]],t[r[e++]],t[r[e++]],t[r[e++]],t[r[e++]]].join("")}var i=0,s=0;function v(r,n,e){var t=function(r,t,o,a){var u=o&&a||0;if("string"==typeof r&&(r=function(r){r=unescape(encodeURIComponent(r));for(var n=new Array(r.length),e=0;e<r.length;e++)n[e]=r.charCodeAt(e);return n}(r)),"string"==typeof t&&(t=function(r){var n=[];return r.replace(/[a-fA-F0-9]{2}/g,(function(r){n.push(parseInt(r,16))})),n}(t)),!Array.isArray(r))throw TypeError("value must be an array of bytes");if(!Array.isArray(t)||16!==t.length)throw TypeError("namespace must be uuid string or an Array of 16 byte values");var f=e(t.concat(r));if(f[6]=15&f[6]|n,f[8]=63&f[8]|128,o)for(var i=0;i<16;++i)o[u+i]=f[i];return o||c(f)};try{t.name=r}catch(r){}return t.DNS="6ba7b810-9dad-11d1-80b4-00c04fd430c8",t.URL="6ba7b811-9dad-11d1-80b4-00c04fd430c8",t}function d(r,n){var e=(65535&r)+(65535&n);return(r>>16)+(n>>16)+(e>>16)<<16|65535&e}function l(r,n,e,t,o,a){return d((u=d(d(n,r),d(t,a)))<<(f=o)|u>>>32-f,e);var u,f}function p(r,n,e,t,o,a,u){return l(n&e|~n&t,r,n,o,a,u)}function y(r,n,e,t,o,a,u){return l(n&t|e&~t,r,n,o,a,u)}function h(r,n,e,t,o,a,u){return l(n^e^t,r,n,o,a,u)}function g(r,n,e,t,o,a,u){return l(e^(n|~t),r,n,o,a,u)}var m=v("v3",48,(function(r){if("string"==typeof r){var n=unescape(encodeURIComponent(r));r=new Array(n.length);for(var e=0;e<n.length;e++)r[e]=n.charCodeAt(e)}return function(r){var n,e,t,o=[],a=32*r.length;for(n=0;n<a;n+=8)e=r[n>>5]>>>n%32&255,t=parseInt("0123456789abcdef".charAt(e>>>4&15)+"0123456789abcdef".charAt(15&e),16),o.push(t);return o}(function(r,n){var e,t,o,a,u;r[n>>5]|=128<<n%32,r[14+(n+64>>>9<<4)]=n;var f=1732584193,c=-271733879,i=-1732584194,s=271733878;for(e=0;e<r.length;e+=16)t=f,o=c,a=i,u=s,f=p(f,c,i,s,r[e],7,-680876936),s=p(s,f,c,i,r[e+1],12,-389564586),i=p(i,s,f,c,r[e+2],17,606105819),c=p(c,i,s,f,r[e+3],22,-1044525330),f=p(f,c,i,s,r[e+4],7,-176418897),s=p(s,f,c,i,r[e+5],12,1200080426),i=p(i,s,f,c,r[e+6],17,-1473231341),c=p(c,i,s,f,r[e+7],22,-45705983),f=p(f,c,i,s,r[e+8],7,1770035416),s=p(s,f,c,i,r[e+9],12,-1958414417),i=p(i,s,f,c,r[e+10],17,-42063),c=p(c,i,s,f,r[e+11],22,-1990404162),f=p(f,c,i,s,r[e+12],7,1804603682),s=p(s,f,c,i,r[e+13],12,-40341101),i=p(i,s,f,c,r[e+14],17,-1502002290),c=p(c,i,s,f,r[e+15],22,1236535329),f=y(f,c,i,s,r[e+1],5,-165796510),s=y(s,f,c,i,r[e+6],9,-1069501632),i=y(i,s,f,c,r[e+11],14,643717713),c=y(c,i,s,f,r[e],20,-373897302),f=y(f,c,i,s,r[e+5],5,-701558691),s=y(s,f,c,i,r[e+10],9,38016083),i=y(i,s,f,c,r[e+15],14,-660478335),c=y(c,i,s,f,r[e+4],20,-405537848),f=y(f,c,i,s,r[e+9],5,568446438),s=y(s,f,c,i,r[e+14],9,-1019803690),i=y(i,s,f,c,r[e+3],14,-187363961),c=y(c,i,s,f,r[e+8],20,1163531501),f=y(f,c,i,s,r[e+13],5,-1444681467),s=y(s,f,c,i,r[e+2],9,-51403784),i=y(i,s,f,c,r[e+7],14,1735328473),c=y(c,i,s,f,r[e+12],20,-1926607734),f=h(f,c,i,s,r[e+5],4,-378558),s=h(s,f,c,i,r[e+8],11,-2022574463),i=h(i,s,f,c,r[e+11],16,1839030562),c=h(c,i,s,f,r[e+14],23,-35309556),f=h(f,c,i,s,r[e+1],4,-1530992060),s=h(s,f,c,i,r[e+4],11,1272893353),i=h(i,s,f,c,r[e+7],16,-155497632),c=h(c,i,s,f,r[e+10],23,-1094730640),f=h(f,c,i,s,r[e+13],4,681279174),s=h(s,f,c,i,r[e],11,-358537222),i=h(i,s,f,c,r[e+3],16,-722521979),c=h(c,i,s,f,r[e+6],23,76029189),f=h(f,c,i,s,r[e+9],4,-640364487),s=h(s,f,c,i,r[e+12],11,-421815835),i=h(i,s,f,c,r[e+15],16,530742520),c=h(c,i,s,f,r[e+2],23,-995338651),f=g(f,c,i,s,r[e],6,-198630844),s=g(s,f,c,i,r[e+7],10,1126891415),i=g(i,s,f,c,r[e+14],15,-1416354905),c=g(c,i,s,f,r[e+5],21,-57434055),f=g(f,c,i,s,r[e+12],6,1700485571),s=g(s,f,c,i,r[e+3],10,-1894986606),i=g(i,s,f,c,r[e+10],15,-1051523),c=g(c,i,s,f,r[e+1],21,-2054922799),f=g(f,c,i,s,r[e+8],6,1873313359),s=g(s,f,c,i,r[e+15],10,-30611744),i=g(i,s,f,c,r[e+6],15,-1560198380),c=g(c,i,s,f,r[e+13],21,1309151649),f=g(f,c,i,s,r[e+4],6,-145523070),s=g(s,f,c,i,r[e+11],10,-1120210379),i=g(i,s,f,c,r[e+2],15,718787259),c=g(c,i,s,f,r[e+9],21,-343485551),f=d(f,t),c=d(c,o),i=d(i,a),s=d(s,u);return[f,c,i,s]}(function(r){var n,e=[];for(e[(r.length>>2)-1]=void 0,n=0;n<e.length;n+=1)e[n]=0;var t=8*r.length;for(n=0;n<t;n+=8)e[n>>5]|=(255&r[n/8])<<n%32;return e}(r),8*r.length))}));function b(r,n,e,t){switch(r){case 0:return n&e^~n&t;case 1:return n^e^t;case 2:return n&e^n&t^e&t;case 3:return n^e^t}}function A(r,n){return r<<n|r>>>32-n}var w=v("v5",80,(function(r){var n=[1518500249,1859775393,2400959708,3395469782],e=[1732584193,4023233417,2562383102,271733878,3285377520];if("string"==typeof r){var t=unescape(encodeURIComponent(r));r=new Array(t.length);for(var o=0;o<t.length;o++)r[o]=t.charCodeAt(o)}r.push(128);var a=r.length/4+2,u=Math.ceil(a/16),f=new Array(u);for(o=0;o<u;o++){f[o]=new Array(16);for(var c=0;c<16;c++)f[o][c]=r[64*o+4*c]<<24|r[64*o+4*c+1]<<16|r[64*o+4*c+2]<<8|r[64*o+4*c+3]}for(f[u-1][14]=8*(r.length-1)/Math.pow(2,32),f[u-1][14]=Math.floor(f[u-1][14]),f[u-1][15]=8*(r.length-1)&4294967295,o=0;o<u;o++){for(var i=new Array(80),s=0;s<16;s++)i[s]=f[o][s];for(s=16;s<80;s++)i[s]=A(i[s-3]^i[s-8]^i[s-14]^i[s-16],1);var v=e[0],d=e[1],l=e[2],p=e[3],y=e[4];for(s=0;s<80;s++){var h=Math.floor(s/20),g=A(v,5)+b(h,d,l,p)+y+n[h]+i[s]>>>0;y=p,p=l,l=A(d,30)>>>0,d=v,v=g}e[0]=e[0]+v>>>0,e[1]=e[1]+d>>>0,e[2]=e[2]+l>>>0,e[3]=e[3]+p>>>0,e[4]=e[4]+y>>>0}return[e[0]>>24&255,e[0]>>16&255,e[0]>>8&255,255&e[0],e[1]>>24&255,e[1]>>16&255,e[1]>>8&255,255&e[1],e[2]>>24&255,e[2]>>16&255,e[2]>>8&255,255&e[2],e[3]>>24&255,e[3]>>16&255,e[3]>>8&255,255&e[3],e[4]>>24&255,e[4]>>16&255,e[4]>>8&255,255&e[4]]}));r.v1=function(r,n,e){var u=n&&e||0,f=n||[],v=(r=r||{}).node||o,d=void 0!==r.clockseq?r.clockseq:a;if(null==v||null==d){var l=r.random||(r.rng||t)();null==v&&(v=o=[1|l[0],l[1],l[2],l[3],l[4],l[5]]),null==d&&(d=a=16383&(l[6]<<8|l[7]))}var p=void 0!==r.msecs?r.msecs:(new Date).getTime(),y=void 0!==r.nsecs?r.nsecs:s+1,h=p-i+(y-s)/1e4;if(h<0&&void 0===r.clockseq&&(d=d+1&16383),(h<0||p>i)&&void 0===r.nsecs&&(y=0),y>=1e4)throw new Error("uuid.v1(): Can't create more than 10M uuids/sec");i=p,s=y,a=d;var g=(1e4*(268435455&(p+=122192928e5))+y)%4294967296;f[u++]=g>>>24&255,f[u++]=g>>>16&255,f[u++]=g>>>8&255,f[u++]=255&g;var m=p/4294967296*1e4&268435455;f[u++]=m>>>8&255,f[u++]=255&m,f[u++]=m>>>24&15|16,f[u++]=m>>>16&255,f[u++]=d>>>8|128,f[u++]=255&d;for(var b=0;b<6;++b)f[u+b]=v[b];return n||c(f)},r.v3=m,r.v4=function(r,n,e){var o=n&&e||0;"string"==typeof r&&(n="binary"===r?new Array(16):null,r=null);var a=(r=r||{}).random||(r.rng||t)();if(a[6]=15&a[6]|64,a[8]=63&a[8]|128,n)for(var u=0;u<16;++u)n[o+u]=a[u];return n||c(a)},r.v5=w,Object.defineProperty(r,"__esModule",{value:!0})}));

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
     * @returns {object} [result]
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

        var options, /**name,*/ src, copy, copyIsArray, clone;



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

                            src     = target[ name ];
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
                                    //clone = src && Array.isArray(src) ? src : [];
                                    if ( src && Array.isArray(src) ) {
                                        clone = src || []
                                    } else if ( isObject(src) ) {
                                        clone = src || {};
                                        target[ name ] = clone;
                                        continue
                                    } else {
                                        clone = []
                                    }

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

                                    target[ name ] = clone;
                                }

                            } else if (copy !== undefined) {
                                //[propose]Don't override existing if prop defined or override @ false
                                if (
                                    typeof(src) != 'undefined'
                                    && src != null
                                    && src !== copy && !override
                                ) {
                                    target[ name ] = src;
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

    };

    // Will not merge functions items: this is normal
    // Merging arrays is OK, but merging collections is still experimental
    var mergeArray = function(options, target, override) {
        newTarget = [];


        var newTargetIds = []
            , keyComparison = browse.getKeyComparison()
            , a             = null
            , aLen          = null
            , i             = 0
        ;

        if (/^true$/i.test(override)) {
            // if collection, comparison will be done uppon the `id` attribute by default unless you call .setKeyComparison('someField')
            if (
                typeof(options[0]) == 'object'
                && typeof(options[0][keyComparison]) != 'undefined'
                && typeof(target[0]) == 'object'
                && typeof(target[0][keyComparison]) != 'undefined'
            ) {

                newTarget =  (Array.isArray(target)) ? Array.from(target) : JSON.clone(target);
                for (var nt = 0, ntLen = newTarget.length; nt < ntLen; ++nt) {
                    newTargetIds.push(newTarget[nt][keyComparison]);
                }

                var _options    = JSON.clone(options);
                var index       = 0;
                a = 0;
                aLen = _options.length;
                for (var n = next || 0, nLen = target.length; n < nLen; ++n) {

                    // if (newTargetIds.indexOf(target[n][keyComparison]) == -1) {
                    //     newTargetIds.push(target[n][keyComparison]);

                    //     //newTarget.push(target[n]);
                    //     //++index;
                    // }

                    label:
                    for (a = a || 0; a < aLen; ++a) {

                        if (_options[a][keyComparison] === target[n][keyComparison] ) {

                            if (newTargetIds.indexOf(_options[a][keyComparison]) > -1) {

                                newTarget[index] = _options[a];
                                ++index;

                            } else if (newTargetIds.indexOf(_options[a][keyComparison]) == -1) {

                                newTargetIds.push(_options[a][keyComparison]);
                                //newTarget.push(_options[a]);
                                newTarget[index] = _options[a];
                                ++index;
                            }

                            break label;

                        } else if (newTargetIds.indexOf(_options[a][keyComparison]) == -1) {

                            newTargetIds.push(_options[a][keyComparison]);
                            newTarget.push(_options[a]);
                        }
                    } // EO For
                }

                newTargetIds = [];

                return newTarget;

            } else { // normal case `arrays` or merging from a blank collection
                if (
                    Array.isArray(options) && options.length == 0
                    ||
                    typeof(options) == 'undefined'
                ) {
                    // means that we are trying to replace with an empty array/collection
                    // this does not make any sense, so we just return the target as if the merge had no effect
                    // DO NOT CHANGE THIS, it affects gina merging config
                    return target;
                }
                return options;
            }
        }

        if ( options.length == 0 &&  target.length > 0 ) {
            newTarget = target;
            return newTarget;
        }

        if ( target.length == 0 && options.length > 0) {
            a = 0;
            for (; a < options.length; ++a ) {
                target.push(options[a]);
            }
        }

        if (newTarget.length == 0 && target.length > 0) {
            // ok, but don't merge objects
            a = 0;
            for (; a < target.length; ++a ) {
                if ( typeof(target[a]) != 'object' && newTarget.indexOf(target[a]) == -1 ) {
                    newTarget.push(target[a]);
                }
            }
        }

        if ( target.length > 0 ) {

            // if collection, comparison will be done uppon the `id` attribute
            if (
                typeof(options[0]) != 'undefined'
                && typeof (options[0]) == 'object'
                && options[0] != null
                && typeof(options[0][keyComparison]) != 'undefined'
                && typeof(target[0]) == 'object'
                && typeof(target[0][keyComparison]) != 'undefined'
            ) {

                newTarget       = (Array.isArray(target)) ? Array.from(target) : JSON.clone(target);
                var _options    = JSON.clone(options);
                var next        = null;

                i = 0;
                a = 0; aLen = newTarget.length;
                for (; a < aLen; ++a) {
                    newTargetIds.push(newTarget[a][keyComparison]);
                }
                a = 0;
                for (; a < aLen; ++a) {

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

                return newTarget;


            } else { // normal case `arrays`
                a = 0;
                for (; a < options.length; ++a ) {
                    if ( target.indexOf(options[a]) > -1 && override) {
                        target.splice(target.indexOf(options[a]), 1, options[a])
                    } else if ( typeof(newTarget[a]) == 'undefined' && typeof(options[a]) == 'object' ) {
                        // merge using index
                        newTarget = target;

                        if (typeof (newTarget[a]) == 'undefined')
                            newTarget[a] = {};


                        for (let k in options[a]) {
                            if (!newTarget[a].hasOwnProperty(k)) {
                                newTarget[a][k] = options[a][k]
                            }
                        }

                    } else {
                        // fixing a = [25]; b = [25,25];
                        // result must be [25,25]
                        if (
                            !override
                            && newTarget.indexOf(options[a]) > -1
                            && typeof(options[a]) == 'number'
                            // ok but not if @ same position
                            //&& options[a] !== newTarget[a]
                        ) {
                            if (options[a] !== newTarget[a]) {
                                newTarget.push(options[a]);
                                continue
                            }

                            //break;
                        }


                        if (
                            typeof (target[a]) != 'undefined'
                            && !/null/i.test(target[a])
                            && typeof (target[a][keyComparison]) != 'undefined'
                            && typeof (options[a]) != 'undefined'
                            && typeof (options[a][keyComparison]) != 'undefined'
                            && target[a][keyComparison] == options[a][keyComparison]
                        ) {
                            if (override)
                                newTarget[a] = options[a]
                            else
                               newTarget[a] = target[a]
                        } else if (newTarget.indexOf(options[a]) == -1 /**&& typeof(options[a]) == 'string'*/) {
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

    // clone target & source to prevent mutations from the originals
    // if (!browse.originalValueshasBeenCached) {
    //     for (let a = 0, aLen = arguments.length; a < aLen; a++) {
    //         if ( typeof(arguments[a]) == 'object' ) {
    //             arguments[a] = JSON.clone(arguments[a]);
    //         }
    //     }
    //     browse.originalValueshasBeenCached = true;
    // }

    return browse
}

if ( ( typeof(module) !== 'undefined' ) && module.exports ) {
    // for unit tests
    if ( typeof(JSON.clone) == 'undefined' ) {
        require('../../../helpers');
    }
    // Publish as node.js module
    module.exports = Merge()
} else if ( typeof(define) === 'function' && define.amd) {
    // Publish as AMD module
    define( 'utils/merge',[],function() { return Merge() })
};
function registerEvents(plugin, events) {
    gina.registeredEvents[plugin] = events
}
function mergeEventProps(evt, proxiedEvent) {
    for (let p in proxiedEvent) {
        // add only missing props
        if ( typeof(evt[p]) == 'undefined' ) {
            evt[p] = proxiedEvent[p];
        }
    }
    return evt;
}
/**
 * addListener
 *
 * @param {object} target
 * @param {object} element
 * @param {string|array} name
 * @param {callback} callback
 */
function addListener(target, element, name, callback) {

    var registerListener = function(target, element, name, callback) {

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

        gina.events[name] = ( typeof(element.id) != 'undefined' && typeof(element.id) != 'object' ) ? element.id : element.getAttribute('id');
    }

    var i = 0, len = null;
    if ( Array.isArray(name) ) {
        len = name.length;
        for (; i < len; i++) {
            registerListener(target, element, name[i], callback)
        }
    } else {
        if ( Array.isArray(element) ) {
            i = 0;
            len = element.length;
            for (; i < len; i++) {
                let evtName =  ( /\.$/.test(name) ) ? name + element[i].id : name;
                registerListener(target, element[i], evtName, callback);
            }
        } else {
            name =  ( /\.$/.test(name) ) ? name + element.id : name;
            registerListener(target, element, name, callback);
        }
    }

}
/**
 * triggerEvent
 * @param {object} target - targeted domain
 * @param {object} element - HTMLFormElement
 * @param {string} name - event ID
 * @param {object|array|string} args - details
 * @param {object} [proxiedEvent]
 */
function triggerEvent (target, element, name, args, proxiedEvent) {
    if (typeof(element) != 'undefined' && element != null) {
        var evt = null, isDefaultPrevented = false, isAttachedToDOM = false, merge  = null;
        // if (proxiedEvent) {
        //     merge = require('utils/merge');
        // }
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
            if (proxiedEvent) {
                // merging props
                evt = mergeEventProps(evt, proxiedEvent);
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

            if (proxiedEvent) {
                // merging props
                evt = mergeEventProps(evt, proxiedEvent);
            }

            element.fireEvent('on' + name, evt);
        }

    } else {
        target.customEvent.fire(name, args);
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

function setupXhr(options) {
    var xhr = null;
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
    if ( typeof(options) != 'undefined' ) {
        if ( !options.url || typeof(options.url) == 'undefined' ) {
            throw new Error('Missing `options.url`');
        }
        if ( typeof(options.method) == 'undefined' ) {
            options.method = 'GET';
        }
        options.method = options.method.toUpperCase();

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

                return;
            }

            if ( typeof(options.responseType) != 'undefined' ) {
                xhr.responseType = options.responseType;
            } else {
                xhr.responseType = '';
            }

            xhr.withCredentials = true;
        } else {
            if (options.isSynchrone) {
                xhr.open(options.method, options.url, options.isSynchrone);
            } else {
                xhr.open(options.method, options.url);
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
    }
    return xhr;
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

    //var merge   = require('utils/merge');

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
        // In case the user is also redirecting
        var redirectDelay = (/Google Inc/i.test(navigator.vendor)) ? 50 : 0;

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

                    return setTimeout(() => {
                        window.location.href = result.location;
                    }, redirectDelay);
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
            //element.removeEventListener(name, callback, false);
            if ( Array.isArray(element) ) {
                i = 0;
                len = element.length;
                for (; i < len; i++) {
                    let evtName =  ( /\.$/.test(name) ) ? name + element[i].id : name;
                    element.removeEventListener(evtName, callback, false);
                    if ( typeof(gina.events[evtName]) != 'undefined' ) {
                        // removed ------> [evtName];
                        delete gina.events[evtName]
                    }
                }
            } else {
                name =  ( /\.$/.test(name) ) ? name + element.id : name;
                element.removeEventListener(name, callback, false);
            }
        } else if (element.attachEvent) {
            //element.detachEvent('on' + name, callback);
            if ( Array.isArray(element) ) {
                i = 0;
                len = element.length;
                for (; i < len; i++) {
                    let evtName =  ( /\.$/.test(name) ) ? name + element[i].id : name;
                    element.detachEvent('on' + evtName, callback);
                    if ( typeof(gina.events[evtName]) != 'undefined' ) {
                        // removed ------> [evtName];
                        delete gina.events[evtName]
                    }
                }
            } else {
                name =  ( /\.$/.test(name) ) ? name + element.id : name;
                element.detachEvent('on' + name, callback);
            }
        }
    } else {
        //target.customEvent.removeListener(name, callback)
        if ( Array.isArray(element) ) {
            i = 0;
            len = element.length;
            for (; i < len; i++) {
                let evtName =  ( /\.$/.test(name) ) ? name + element[i].id : name;
                target.customEvent.removeListener(evtName, callback);
                if ( typeof(gina.events[evtName]) != 'undefined' ) {
                    // removed ------> [evtName];
                    delete gina.events[evtName]
                }
            }
        } else {
            name =  ( /\.$/.test(name) ) ? name + element.id : name;
            target.customEvent.removeListener(name, callback)
        }
    }

    if ( typeof(gina.events[name]) != 'undefined' ) {
        // removed ------> [name];
        delete gina.events[name]
    }
    if ( typeof(callback) != 'undefined' ) {
        callback()
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

                //triggerEvent(gina, e.currentTarget, e.type);
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

function PrototypesHelper(instance) {

    var isGFFCtx        = ( ( typeof(module) !== 'undefined' ) && module.exports ) ? false : true;

    var local = instance || null;
    var envVars = null;
    // since for some cases we cannot use gina envVars directly
    if (
        typeof(GINA_DIR) == 'undefined'
        && !isGFFCtx
        && typeof(process) != 'undefined'
        && process.argv.length > 3
    ) {
        if ( /^\{/.test(process.argv[2]) ) {
            envVars = JSON.parse(process.argv[2]).envVars;
        }
        // minions case
        else if ( /\.ctx$/.test(process.argv[2]) ) {
            var fs = require('fs');
            var envVarFile = process.argv[2].split(/\-\-argv\-filename\=/)[1];
            envVars = JSON.parse(fs.readFileSync(envVarFile).toString()).envVars;
        }

    }
    // else if (isGFFCtx) {
    //     envVars = window;
    // }


    // dateFormat proto
    if ( local && typeof(local) != 'undefined' && typeof(local.dateFormat) != 'undefined' ) {
        for (let method in local.dateFormat) {

            if ( typeof(Date[method]) != 'undefined' )
                continue;

            Object.defineProperty( Date.prototype, method, {
                writable:   false,
                enumerable: false,
                //If loaded several times, it can lead to an exception. That's why I put this.
                configurable: true,
                value: function() {

                    var newArgs = { 0: this }, i = 1;
                    for (var a in arguments) {
                        newArgs[i] = arguments[a];
                        ++i
                    }
                    newArgs.length = i;
                    // don't touch this, we need the name
                    const name = method;

                    return local.dateFormat[name].apply(this, newArgs );
                }
            });

        }
    }



    if ( typeof(Array.clone) == 'undefined' ) {
        /**
         * clone array
         *
         * @returns {array} Return cloned array
         * @supress {misplacedTypeAnnotation}
         **/
        Object.defineProperty( Array.prototype, 'clone', {
            writable:   false,
            enumerable: false,
            //If loaded several times, it can lead to an exception. That's why I put this.
            configurable: true,
            value: function(){ return this.slice(0); }
        });
    }

    if ( typeof(JSON.clone) == 'undefined' && !isGFFCtx ) {
        if ( typeof(envVars) != 'undefined' ) {
            JSON.clone = require( envVars.GINA_DIR +'/utils/prototypes.json_clone');
        } else {
            JSON.clone = require( GINA_DIR +'/utils/prototypes.json_clone');
        }
    }

    if ( typeof(JSON.escape) == 'undefined' ) {
        /**
         * JSON.escape
         * Escape special characters
         *
         * Changes made here must be reflected in:
         *  - gina/utils/prototypes.js
         *  - gina/framework/version/helpers/prototypes.js
         *  - gina/framework/version/core/asset/plugin/src/gina/utils/polyfill.js
         *
         * @param {object} jsonStr
         *
         * @returns {object} escaped JSON string
         **/
         var escape = function(jsonStr){
            try {
                return jsonStr
                           .replace(/\n/g, "\\n")
                           .replace(/\r/g, "\\r")
                           .replace(/\t/g, "\\t")
                       ;
            } catch (err) {
               throw err;
            }
        };

        JSON.escape = escape;
    }


    if ( typeof(Array.toString) == 'undefined' ) {
        Array.prototype.toString = function(){
            return this.join();
        };
    }

    if ( typeof(Array.inArray) == 'undefined' ) {
        Object.defineProperty( Array.prototype, 'inArray', {
            writable:   false,
            enumerable: false,
            //If loaded several times, it can lead to an exception. That's why I put this.
            configurable: true,
            value: function(o){ return this.indexOf(o)!=-1 }
        });
    }

    if ( typeof(Array.from) == 'undefined' ) { // if not under ES6

        Object.defineProperty( Array.prototype, 'from', {
            writable:   false,
            enumerable: false,
            //If loaded several times, it can lead to an exception. That's why I put this.
            configurable: true,
            value: function(a){
                var seen    = {}
                    , out   = []
                    , len   = a.length
                    , j     = 0;

                for(var i = 0; i < len; i++) {
                    var item = a[i];
                    if(seen[item] !== 1) {
                        seen[item] = 1;
                        out[j++] = item
                    }
                }

                return out
            }
        });
    }

    if ( typeof(Object.count) == 'undefined' ) {
        Object.defineProperty( Object.prototype, 'count', {
            writable:   true,
            enumerable: false,
            //If loaded several times, it can lead to an exception. That's why I put this.
            configurable: true,
            value: function(){
                var i = 0;
                try {
                    var self = this;
                    if (this instanceof String) self = JSON.parse(this);

                    for (var prop in this)
                        if (this.hasOwnProperty(prop)) ++i;

                    return i;
                } catch (err) {
                    return i;
                }

            }
        });
    }



    if ( typeof(global) != 'undefined' && typeof(global.__stack) == 'undefined' ) {
        /**
         * __stack Get current stack
         * @returns {Object} stack Current stack
         * @suppress {es5Strict}
         **/
        Object.defineProperty(global, '__stack', {
            //If loaded several times, it can lead to an exception. That's why I put this.
            configurable: true,
            get: function(){
                var orig = Error.prepareStackTrace;
                Error.prepareStackTrace = function(_, stack){
                    return stack;
                };
                var err = new Error;
                /** @suppress {es5Strict} */
                Error.captureStackTrace(err, arguments.callee);
                var stack = err.stack;
                Error.prepareStackTrace = orig;
                return stack;
            }
        });
    }


}

if ( ( typeof(module) !== 'undefined' ) && module.exports ) {
    // Publish as node.js module
    module.exports = PrototypesHelper
} else if ( typeof(define) === 'function' && define.amd) {
    // Publish as AMD module
    define( 'helpers/prototypes',[],function() { return PrototypesHelper })
}
;
/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2023 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */
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

    var isGFFCtx        = ( ( typeof(module) !== 'undefined' ) && module.exports ) ? false : true;
    var merge           = (isGFFCtx) ? require('utils/merge') : require('./../lib/merge');


    // if ( typeof(define) === 'function' && define.amd ) {
    //     var Date = this.Date;
    // }

    var self = {};
    // language-country
    self.culture = 'en-US'; // by default
    self.lang = 'en'; // by default

    self.masks = {
        // i18n
        "default":      "ddd mmm dd yyyy HH:MM:ss",
        shortDate:      "m/d/yy",
        shortDate2:      "mm/dd/yyyy",
        mediumDate:     "mmm d, yyyy",
        longDate:       "mmmm d, yyyy",
        fullDate:       "dddd, mmmm d, yyyy",
        // common
        cookieDate:     "GMT:ddd, dd mmm yyyy HH:MM:ss",
        logger:       "yyyy mmm dd HH:MM:ss",
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
        longIsoDateTime:    "yyyy-mm-dd'T'HH:MM:ss.L",
        isoUtcDateTime: "UTC:yyyy-mm-dd'T'HH:MM:ss'Z'"
    };

    self.i18n = {
        'en': {
            dayNames: [
                "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat",
                "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"
            ],
            monthNames: [
                "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
                "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"
            ],
            masks: {
                "default":      "ddd mmm dd yyyy HH:MM:ss",
                shortDate:      "m/d/yy",
                shortDate2:      "mm/dd/yyyy",
                mediumDate:     "mmm d, yyyy",
                longDate:       "mmmm d, yyyy",
                fullDate:       "dddd, mmmm d, yyyy"
            }
        },
        'fr': {
            dayNames: [
                "dim", "lun", "mar", "mer", "jeu", "ven", "sam",
                "dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"
            ],
            monthNames: [
                "Jan", "Fév", "Mar", "Avr", "Mai", "Jui", "Juil", "Aoû", "Sep", "Oct", "Nov", "Déc",
                "Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"
            ],
            masks: {
                "default":      "ddd mmm dd yyyy HH:MM:ss",
                shortDate:      "d/m/yy",
                shortDate2:      "dd/mm/yyyy",
                mediumDate:     "d mmm, yyyy",
                longDate:       "d mmmm, yyyy",
                fullDate:       "dddd, d mmmm, yyyy"
            }
        }
    };

    /**
     *
     * @param {string} culture (5 chars) | lang (2 chars)
     */
    var setCulture = function(date, culture) {
        if (/\-/.test(culture) ) {
            self.culture = culture;
            self.lang = culture.split(/\-/)[0];
        } else {
            self.lang = culture
        }

        return this
    }

    var format = function(date, mask, utc) {

        // if ( typeof(merge) == 'undefined' || !merge ) {
        //     merge = (isGFFCtx) ? require('utils/merge') : require('./../lib/merge');

        // }

        var dF          = self
            , i18n      = dF.i18n[dF.lang] || dF.i18n['en']
            //, masksList = merge(i18n.masks, dF.masks)
            , masksList = null
        ;

        try {
            masksList = merge(i18n.masks, dF.masks);
        } catch( mergeErr) {
            // called from logger - redefinition needed for none-dev env: cache issue
            isGFFCtx        = ( ( typeof(module) !== 'undefined' ) && module.exports ) ? false : true;
            merge           = (isGFFCtx) ? require('utils/merge') : require('./../lib/merge');
            masksList = merge(i18n.masks, dF.masks);
        }

        if ( typeof(dF.i18n[dF.culture]) != 'undefined' ) {
            i18n  = dF.i18n[dF.culture];
            if ( typeof(dF.i18n[dF.culture].mask) != 'undefined' ) {
                masksList = merge(i18n.masks, dF.masks)
            }
        }

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

        mask = String(masksList[mask] || mask || masksList["default"]);

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
                ddd:  i18n.dayNames[D],
                dddd: i18n.dayNames[D + 7],
                m:    m + 1,
                mm:   pad(m + 1),
                mmm:  i18n.monthNames[m],
                mmmm: i18n.monthNames[m + 12],
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
                // L:    pad(L > 99 ? Math.round(L / 10) : L),
                L:    pad(L),
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
     * @returns {string} maskName
     * */
    // var getMaskNameFromFormat = function (format) {

    //     var name = "default";

    //     for (var f in self.masks) {
    //         if ( self.masks[f] === format )
    //             return f
    //     }

    //     return name
    // }


    /**
     *  Count days from the current date to another
     *
     *  TODO - add a closure to `ignoreWeekend()` based on Lib::Validator
     *  TODO - add a closure to `ignoreFromList(array)` based on Lib::Validator
     *
     *  @param {object} dateTo
     *  @returns {number} count
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
     *  @returns {array} dates
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
     * getQuarter
     * Get quarter number
     * To test : https://planetcalc.com/1252/
     * Based on fiscal year- See.: https://en.wikipedia.org/wiki/Fiscal_year
     *
     * TODO - Complete fiscalCodes
     *
     * @param {object} [date] if not defined, will take today's value
     * @param {string} [code] - us|eu
     *
     * @returns {number} quarterNumber - 1 to 4
     */
    var fiscalCodes = ['us', 'eu', 'corporate'];
    var getQuarter = function(date, code) {
        if (
            arguments.length == 1
            && typeof(arguments[0]) == 'string'
        ) {
            if ( fiscalCodes.indexOf(arguments[0].toLowerCase()) < 0 ) {
                throw new Error('Quarter '+ arguments[0] +' code not supported !');
            }
            date = new Date();
            code = arguments[0]
        }
        if ( typeof(date) == 'undefined' ) {
            date = new Date();
        }
        if ( typeof(code) == 'undefined') {
            code = 'corporate';
        }

        code = code.toLowerCase();
        var q = [1,2,3,4]; // EU & corporates by default
        switch (code) {
            case 'us':
                q = [4,1,2,3];
                break;

            case 'corportate':
            case 'eu':
                q = [1,2,3,4]
                break;
            default:
                // EU & corporates by default
                q = [1,2,3,4];
                break;
        }

        return q[Math.floor(date.getMonth() / 3)];
    }

    /**
     * getHalfYear
     *
     * Based on fiscal year- See.: https://en.wikipedia.org/wiki/Fiscal_year
     *
     * @param {object} date
     * @param {string} code
     *
     * @returns halfYear number - 1 to 2
     */
    var getHalfYear = function(date, code) {
        if (
            arguments.length == 1
            && typeof(arguments[0]) == 'string'
        ) {
            if ( fiscalCodes.indexOf(arguments[0].toLowerCase()) < 0 ) {
                throw new Error('Quarter '+ arguments[0] +' code not supported !');
            }
            date = new Date();
            code = arguments[0]
        }
        if ( typeof(date) == 'undefined' ) {
            date = new Date();
        }
        if ( typeof(code) == 'undefined') {
            code = 'corporate';
        }

        code = code.toLowerCase();

        return (date.getQuarter(code) <=2 ) ? 1 : 2;
    }

    /**
     * getWeekISO8601
     * Get week number
     * ISO 8601
     * To test : https://planetcalc.com/1252/
     *
     * @param {object} [date] if not defined, will take today's value
     *
     * @returns {number} weekNumber
     */
    var getWeekISO8601 = function(date) {
        // Copy date so don't modify original
        d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        // Make Sunday's day number 7
        var dayNum = d.getDay() || 7;
        d.setDate(d.getDate() + 4 - dayNum);
        var yearStart = new Date(Date.parse(d.getFullYear(),0,1));

        return Math.ceil((((d - yearStart) / 86400000) + 1)/7)
    }

    /**
     * getWeek
     * Get week number
     * To test : https://planetcalc.com/1252/
     *
     * @param {object} [date] if not defined, will take today's value
     *
     * @returns {number} weekNumber - 1 to 53
     */
    var getWeek = function(date, standardMethod) {
        if ( typeof(date) == 'undefined' ) {
            date = new Date();
        }
        if ( typeof(standardMethod) == 'undefined') {
            standardMethod = 'ISO 8601';
        }

        standardMethod = standardMethod.replace(/\s+/g, '').toLowerCase();
        switch (standardMethod) {
            case 'corporate':
            case 'eu':
            case 'iso8601':
                return getWeekISO8601(date)

            default:
                return getWeekISO8601(date)
        }
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
        copiedDate.setHours(copiedDate.getHours() + h);
        return copiedDate;
    }


    /**
     * Add or subtract days
     *  Adding 2 days
     *      => myDate.addDays(2)
     *  Subtracting 10 days
     *      => myDate.addDays(-10)
     * */
    var addDays = function(date, d) {
        var copiedDate = new Date(date.getTime());
        copiedDate.setHours(copiedDate.getHours() + d * 24);
        return copiedDate;
    }

    /**
     * Add or subtract years
     *  Adding 2 days
     *      => myDate.addYears(2)
     *  Subtracting 10 years
     *      => myDate.addYears(-10)
     * */
    var addYears = function(date, y) {
        var copiedDate = new Date(date.getTime());
        copiedDate.setFullYear(copiedDate.getFullYear() + y);
        return copiedDate;
    }

    var _proto = {
        setCulture      : setCulture,
        format          : format,
        countDaysTo     : countDaysTo,
        getDaysTo       : getDaysTo,
        getDaysInMonth  : getDaysInMonth,
        getQuarter      : getQuarter,
        getHalfYear     : getHalfYear,
        getWeek         : getWeek,
        addHours        : addHours,
        addDays         : addDays,
        addYears        : addYears
    };

    return _proto

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
 * @returns {object} instance
 *
 * Collection.length will return result length : dont't use .count() which is going to include functions to the count
 *
 * Collection::find
 *  @param {object} filter
 *      eg.: { uid: 'someUID' }
 *      eg.: { type: 'not null', country: 'France' } // `AND` clause
 *      NB.: To filter `not empty`, use { type: '!=""' }
 *      eg.: { country: 'The Hashemite Kingdom of Jordan' }, { country: 'Libanon'} // `OR` clause
 *      eg.: { 'obj.prop': true }
 *      eg.: { 'contacts[*].name': 'Doe' } // `WITHIN` (array|collection) clause
 *      eg.: { lastUpdate: '>= 2016-12-01T00:00:00' }  // also available for date comparison `=`, `<`, `>`
 *      eg.: { activity: null }
 *      eg.: { isActive: false }
 *
 *  @returns {array} result
 *
 * Collection::findOne
 *  @param {object} filter
 *  @returns {object|array|string} result
 *
 * Collection::update
 *  @param {object} filter
 *  @param {object} set
 *
 *  @returns {array} result
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
    var withOrClause = false;
    var notInSearchModeEnabled = false;

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
            return eval(condition);
        } catch(err) {
            throw new Error('Could not evaluate condition `'+ condition +'`.\n' + err.stack );
        }
    }

    if (typeof(content) == 'undefined' || content == '' || content == null)
        content = [];

    if ( !Array.isArray(content) )
        throw new Error('`new Collection([content] [, options] )`: `content` argument must be an Array !');

    content = (content) ? JSON.clone(content) : []; // original content -> not to be touched

    // Indexing : uuids are generated for each entry
    var searchIndex = [], idx = 0;
    for (var entry = 0, entryLen = content.length; entry < entryLen; ++entry) {
        if (!content[entry]) {
            content[entry] = {};
        }
        content[entry]._uuid = uuid.v4();
        // To avoid duplicate entries
        searchIndex[idx] = content[entry]._uuid;
        ++idx;
    }

    var instance = content;
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
     * @returns {object} instance with local search options
     */
    instance['setSearchOption'] = function() {

        if (!arguments.length)
            throw new Error('searchOption cannot be left blank');

        if (arguments.length > 3 || arguments.length < 3 && arguments.length > 1)
            throw new Error('argument length mismatch');

        var i       = 0
            , len   = arguments.length
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
        // reset
        withOrClause = false;

        if ( typeof(arguments[arguments.length-1]) == 'boolean' ) {
            withOrClause = arguments[arguments.length-1];
            delete arguments[arguments.length-1];
            --arguments.length;
        }

        var filtersStr      = null;
        var filters         = null;
        var filtersCount    = null;
        try {
            filtersStr      = JSON.stringify(arguments);
            filters         = JSON.parse(filtersStr);
            filtersCount    = filters.count();
        } catch( filtersError) {
            throw new Error('filter must be an object\n'+ filtersError.stack);
        }

        if ( typeof(filters) != 'undefined' && filtersCount > 0 ) {

            if (filtersCount > 1) {
                withOrClause = true;
            }
            // checking filter : this should be forbidden -> { type: 'red', type: 'orange'}
            // var filtersFields = null;
            // for (let f = 0, fLen = filters.count(); f < fLen; f++) {
            //     filtersFields = {};
            //     for (let fField in filters[f]) {
            //         if (  typeof(filtersFields[ fField ]) != 'undefined' ) {
            //             throw new Error('Filter field can only be defined once inside a filter object !\n`Field '+ fField +'` is already defined : '+ filters[f])
            //         }
            //         filtersFields[ fField ] = true;
            //     }
            // }

            var filter              = null
                , condition         = null
                , i                 = 0
                //, tmpContent        = ( Array.isArray(this) && !withOrClause) ? this : JSON.clone(content)
                , tmpContent        = ( Array.isArray(this) ) ? this : JSON.clone(content)
                , resultObj         = {}
                , result            = []
                , localeLowerCase   = ''
                , re                = null
                , field             = null
                , fieldWithin       = null
                , value             = null
                , searchOptions     = localSearchOptions
                , searchOptionRules = options.searchOptionRules
            ;

            var matched = null
                , filterIsArray = null
                , searchResult = [];

            /**
             *  Regular Search
             * @param {object} filter
             * @param {string} field
             * @param {strine|number|date} _content
             * @param {number} matched
             */
            var search = function(filter, field, _content, matched, searchOptionRules) {
                var reValidCount = null, searchOptCount = null;
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
                    let originalFilter = filter;
                    let condition = _content + filter;
                    if ( typeof(filter) == 'string' && typeof(_content) == 'string' ) {
                        let comparedValue = filter.replace(/^(<=|>=|!==|!=|===|!==)/g, '');
                        if ( typeof(_content) == 'string' && !/^\"(.*)\"$/.test(comparedValue) ) {
                            filter = filter.replace(comparedValue, '\"'+ comparedValue + '\"');
                        }
                        condition = '\"'+_content+'\"' + filter;
                        // restoring in case of datetime eval
                        filter = originalFilter;
                    }

                    // looking for a datetime ?
                    if (
                        /(\d{4})\-(\d{2})\-(\d{2})(\s+|T)(\d{2}):(\d{2}):(\d{2})/.test(_content)
                        && /(\d{4})\-(\d{2})\-(\d{2})(\s+|T)(\d{2}):(\d{2}):(\d{2})/.test(filter)
                    ) {

                        if (tryEval(_content.replace(/(\d{4})\-(\d{2})\-(\d{2})(\s+|T)(\d{2}):(\d{2}):(\d{2})/, 'new Date("$&")') + filter.replace(/(\d{4})\-(\d{2})\-(\d{2})(\s+|T)(\d{2}):(\d{2}):(\d{2})/, 'new Date("$&")'))) {
                            ++matched;
                        }

                    } else if (tryEval(condition)) {
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
                };
            }

            var searchThroughProp = function(filter, f, _content, matched) {

                var field = f.split(/\./g);
                field = field[field.length - 1];
                re = new RegExp('("' + field + '":\\w+)');

                var value = null;

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

                if (!/undefined|function/.test( typeof(tmpContent[o]))) {

                    for (let l = 0, lLen = filters.count(); l<lLen; ++l) {
                        filter = filters[l];
                        condition = filter.count();
                        // for each condition
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

                        if (matched == condition ) { // all conditions must be fulfilled to match
                            // `this` {Array} is the result of the previous search or the current content
                            // TODO - Add a switch
                            if (
                                withOrClause
                                && notInSearchModeEnabled
                                && searchIndex.indexOf(tmpContent[o]._uuid) < 0
                                || notInSearchModeEnabled
                                || !withOrClause
                            ) {
                                //console.debug('searchIndex ', searchIndex);
                                if (!withOrClause || withOrClause && result.indexOf(tmpContent[o]._uuid) < 0 || notInSearchModeEnabled) {
                                    result[i] = tmpContent[o];
                                    ++i;
                                }
                            } else if (
                                withOrClause
                                && !notInSearchModeEnabled
                            ) {
                                if (result.indexOf(tmpContent[o]._uuid) < 0) {
                                    result[i] = tmpContent[o];
                                    ++i;
                                }
                            }
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
        //if (withOrClause) {
            // merging with previous result
            //console.debug('withOrClause: supposed to merge ? \nnotInSearchModeEnabled: '+notInSearchModeEnabled+'\nResult: ' +result)//+'\nThis: '+ this.toRaw();
            // if (!notInSearchModeEnabled) {
            //     result  = merge(this, result);
            // }
            // TODO - remove this part
            // Removed this on 2021-01-21 because it was causing duplicate content
            //result  = merge(this, result, true)
        //}

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
        result.filter           = instance.filter;

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
     * @returns {object} result
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
            --arguments.length;
        }

        // if ( typeof(arguments[arguments.length-1]) == 'boolean' ) {
        //     uuidSearchModeEnabled = arguments[arguments.length - 1]
        //     delete arguments[arguments.length - 1];
        //     --arguments.length;
        // }

        if (arguments.length > 0) {
            filters = arguments;
        }


        if ( typeof(filters) == 'undefined' || !filters || typeof(filters) != 'object' ) {
            throw new Error('[ Collection ][ findOne ] `filters` argument must be defined: Array or Filter Object(s) expected');
        }

        // If an operation (find, insert ...) has been executed, get the previous result; if not, get the whole collection
        //var currentResult = JSON.clone( (Array.isArray(this)) ? this : content );
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


    instance['or'] = function () {
        arguments[arguments.length] = true;
        ++arguments.length;

        return instance.find.apply(this, arguments);
    }

    instance['limit'] = function(resultLimit) {
        if ( typeof(resultLimit) == 'undefined' || typeof(resultLimit) != 'number' ) {
            throw new Error('[Collection::result->limit(resultLimit)] : `resultLimit` parametter must by a `number`')
        }

        var result = Array.isArray(this) ? this : JSON.clone(content);

        //resultLimit
        result = result.splice(0, resultLimit);

        // chaining
        result.insert   = instance.insert;
        result.update   = instance.update;
        result.replace  = instance.replace;
        result.notIn    = instance.notIn;
        result.findOne  = instance.findOne;
        result.orderBy  = instance.orderBy;
        result.max      = instance.max;
        result.delete   = instance.delete;
        result.toRaw    = instance.toRaw;
        result.filter   = instance.filter;

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
     * .noIn(collectionObj, 'id')
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
            --arguments.length;
        }

        if ( typeof(arguments[arguments.length-1]) == 'boolean' ) {
            uuidSearchModeEnabled = arguments[arguments.length - 1]
            delete arguments[arguments.length - 1];
            --arguments.length;
        }

        if (arguments.length > 0) {
            filters = arguments;
        }


        if ( typeof(filters) == 'undefined' || !filters || typeof(filters) != 'object' ) {
            throw new Error('[ Collection ][ notIn ] `filters` argument must be defined: Array or Filter Object(s) expected');
        }

        // If an operation (find, insert ...) has been executed, get the previous result; if not, get the whole collection
        var currentResult = JSON.clone( (Array.isArray(this)) ? this : content );

        var foundResults = null;
        if ( Array.isArray(arguments[0]) ) {
            foundResults    = arguments[0];
        } else {
            notInSearchModeEnabled = true;
            foundResults    = instance.find.apply(this, arguments) || [];
            notInSearchModeEnabled = false;
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
            } else if ( typeof(foundResults[0]['id']) != 'undefined' ) {
                key = 'id';
            }

            if ( !key || typeof(foundResults[0][key]) == 'undefined' ) {
                throw new Error('No comparison key defined !')
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
                currentResult = JSON.clone(foundResults);

            } else { // search based on provided filters
                // for every single result found
                for (; r < rLen; ++r) {
                    if (!currentResult.length) break;

                    //onRemoved:
                    c = 0; cLen = currentResult.length;
                    for (; c < cLen; ++c) { // current results

                        if ( typeof (currentResult[c]) != 'undefined' ) {

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
        result.max      = instance.max;
        result.delete   = instance.delete;
        result.toRaw    = instance.toRaw;
        result.filter   = instance.filter;

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
        result.max      = instance.max;
        result.notIn    = instance.notIn;
        result.delete   = instance.delete;
        result.toRaw    = instance.toRaw;
        result.filter   = instance.filter;

        return result
    }

    /**
     * update
     *
     * @param {object} filter
     * @param {object} set
     *
     * @returns {objet} instance
     */
    instance['update'] = function() {
        var key         = '_uuid' // comparison key is _uuid by default
            , result    = null
            , filters   = null
            , set       = null
            //, uuidSearchModeEnabled = true
        ;

        // comparison key  : _uuid by default, but can be set to id
        if ( typeof(arguments[arguments.length-1]) == 'string' ) {
            key = arguments[arguments.length - 1];
            delete arguments[arguments.length - 1];
            --arguments.length;
        }

        if ( typeof(arguments[arguments.length-1]) == 'object' ) {
            set = arguments[arguments.length - 1];
            delete arguments[arguments.length - 1];
            --arguments.length
        }

        // if ( typeof(arguments[arguments.length-1]) == 'boolean' ) {
        //     uuidSearchModeEnabled = arguments[arguments.length - 1]
        //     delete arguments[arguments.length - 1];
        //     --arguments.length;
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
        var foundResults = null;
        if ( Array.isArray(arguments[0]) ) {
            foundResults = arguments[0];
        } else {
            foundResults = instance.find.apply(this, arguments) || [];
        }

        result = Array.isArray(this) ? this : JSON.clone(content);
        if (foundResults.length > 0 ) {
            var arr = foundResults.toRaw();
            for (var a = 0, aLen = arr.length; a < aLen; ++a) {
                arr[a] = merge( JSON.clone(set), arr[a]);
                for (var r = 0, rLen = result.length; r < rLen; ++r) {
                    if ( typeof(result[r][key]) == 'undefined' && key == '_uuid' && typeof(result[r]['id']) != 'undefined' ) {
                        key = 'id';
                    }

                    if ( result[r][key] == arr[a][key] ) {
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
        result.max      = instance.max;
        result.notIn    = instance.notIn;
        result.delete   = instance.delete;
        result.toRaw    = instance.toRaw;
        result.filter   = instance.filter;

        return result
    }


    instance['replace'] = function() {
        var key         = '_uuid' // comparison key
            , result    = null
            , filters   = null
            , set       = null
            //, uuidSearchModeEnabled = true
        ;


        if ( typeof(arguments[arguments.length-1]) == 'string' ) {
            key = arguments[arguments.length - 1];
            delete arguments[arguments.length - 1];
            --arguments.length;
        }

        if ( typeof(arguments[arguments.length-1]) == 'object' ) {
            set = arguments[arguments.length - 1];
            delete arguments[arguments.length - 1];
            --arguments.length;
        }

        // if ( typeof(arguments[arguments.length-1]) == 'boolean' ) {
        //     uuidSearchModeEnabled = arguments[arguments.length - 1]
        //     delete arguments[arguments.length - 1];
        //     --arguments.length;
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
        //var currentResult = JSON.clone( (Array.isArray(this)) ? this : content );
        var currentResult = null;
        var foundResults = null;
        if ( Array.isArray(arguments[0]) ) {
            foundResults = arguments[0];
        } else {
            foundResults = instance.find.apply(this, arguments) || [];
        }

        result = Array.isArray(this) ? this : JSON.clone(content);
        if (foundResults.length > 0 ) {
            var arr = foundResults.toRaw();
            for (var a = 0, aLen = arr.length; a < aLen; ++a) {
                arr[a] = JSON.clone(set);
                for (var r = 0, rLen = result.length; r < rLen; ++r) {
                    if ( typeof(result[r][key]) == 'undefined' && key == '_uuid' && typeof(result[r]['id']) != 'undefined' ) {
                        key = 'id';
                    } else if (typeof(result[r][key]) == 'undefined' && key == '_uuid') {
                        throw new Error('No comparison key defined !')
                    }

                    if ( result[r][key] == arr[a][key] ) {
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
        result.max      = instance.max;
        result.notIn    = instance.notIn;
        result.delete   = instance.delete;
        result.toRaw    = instance.toRaw;
        result.filter   = instance.filter;

        return result
    }

    /**
     * .delete({ key: 2 })
     * .delete({ name: 'Jordan' }, ''id) where id will be use as the `uuid` to compare records
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
     * @returns {array} result
     */
    instance['delete'] = function() {

        var result = instance.notIn.apply(this, arguments);

        result.limit    = instance.limit;
        result.find     = instance.find;
        result.findOne  = instance.findOne;
        result.insert   = instance.insert;
        result.update   = instance.update;
        result.replace  = instance.replace;
        result.orderBy  = instance.orderBy;
        result.max      = instance.max;
        result.notIn    = instance.notIn;
        result.toRaw    = instance.toRaw;
        result.filter   = instance.filter;
        result.delete   = this.delete;

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
            throw new Error('[ Collection->orderBy(filter) ] where `filter` must not be empty or null' );

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

        var variableContent = (Array.isArray(this)) ? this : JSON.clone(content);
        return sortResult(filter, variableContent.toRaw())
    }

    /**
     * max
     * E.g:
     *  myCollection.max({ order: 'not null'})
     *      => 5
     *  myCollection.max({ createAt: 'not null'})
     *      => '2021-12-31T23:59:59'
     *  myCollection.max({ firstName: 'not null'})
     *      => 'Zora'
     *
     * @param {object|array} filter
     *
     * @returns {number|date|string}
     * */
    instance['max'] = function () {
        if ( typeof(arguments) == 'undefined' || arguments.length < 1)
            throw new Error('[ Collection->max(filter) ] where `filter` must not be empty or null' );

        var filter = null;
        if (
            arguments.length > 1
            || Array.isArray(arguments[0])
            || typeof(arguments[0]) == 'object' && arguments[0].count() > 1
        ) {
            throw new Error('[ Collection->max(filter) ] only accept one filter length, and fileter count must be equal to 1' );
        }
        filter = arguments[0];
        try {
            var key = Object.keys(filter)[0];
            var subFilter = {};
            subFilter[key] = 'desc';
            return instance['find'](filter).orderBy(subFilter).limit(1)[0][key];
        } catch (err) {
            throw err
        }
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
            , multiSortOp       = null
            , sortRecursive     = null
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
        result.max      = instance.max;
        result.toRaw    = instance.toRaw;
        result.filter   = instance.filter;

        return result
    };

    /**
     * toRaw
     * Transform result into a clean format (without _uuid)
     *
     * @returns {array} result
     * */
    instance['toRaw'] = function() {

        var result = ( Array.isArray(this) ) ? this : content;
        // cleanup
        for (var i = 0, len = result.length; i < len; ++i) {
            if (result[i]._uuid)
                delete result[i]._uuid;
        }

        return JSON.clone(result);
    }

    /**
     * filter
     * Reduce record propName
     * @param {string|array} filter
     *  e.g: 'id'
     *  e.g: ['id', 'name']
     *
     * @returns {array} rawFilteredResult
     * */
     instance['filter'] = function(filter) {

        if ( typeof(filter) == 'undefined' ) {
            throw new Error('`filter` parametter must be a string or an array.');
        }
        var result = ( Array.isArray(this) ) ? this : content;
        if ( !result.length ) {
            return []
        }
        var i = 0, len = result.length;
        var rawFilteredResult = [], fCount = 0;

        if ( Array.isArray(filter) ) {
            var f = null, fLen = filter.length, wrote = null;
            for (; i < len; ++i) {
                wrote = false;
                f = 0;
                for (; f < fLen; ++f) {
                    if ( typeof(result[i][ filter[f] ]) != 'undefined' ) {
                        if ( typeof(rawFilteredResult[fCount]) == 'undefined' ) {
                            rawFilteredResult[fCount] = {}
                        }
                        rawFilteredResult[fCount][ filter[f] ] = result[i][ filter[f] ];
                        wrote = true;
                    }
                }
                if (wrote)
                    ++fCount;
            }
        } else {
            for (; i < len; ++i) {
                if ( typeof(result[i][filter]) != 'undefined' ) {
                    if ( typeof(rawFilteredResult[fCount]) == 'undefined' ) {
                        rawFilteredResult[fCount] = {}
                    }
                    rawFilteredResult[fCount][filter] = result[i][filter];
                    ++fCount;
                }
            }
        }

        return JSON.clone(rawFilteredResult);
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
/**
 * FormValidatorUtil
 *
 * Dependencies:
 *  - utils/helpers
 *  - utils/helpers/dateFormat
 *  - utils/merge
 *  - utils/routing (for API calls)
 *
 * @param {object} data
 * @param {object} [ $fields ] - isGFFCtx only
 * @param {object} [ xhrOptions ] - isGFFCtx only
 * @param {object} [ fieldsSet ] - isGFFCtx only; required for when ginaFormLiveCheckEnabled
 * */
function FormValidatorUtil(data, $fields, xhrOptions, fieldsSet) {

    var isGFFCtx        = ( ( typeof(module) !== 'undefined' ) && module.exports ) ? false : true;

    // if (isGFFCtx && !$fields )
    //     throw new Error('No `Validator` instance found.\nTry:\nvar FormValidator = require("gina/validator"):\nvar formValidator = new FormValidator(...);')

    var merge           = (isGFFCtx) ? require('utils/merge') : require('../../../../../lib/merge');
    var helpers         = (isGFFCtx) ? {} : require('../../../../../helpers');
    var dateFormat      = (isGFFCtx) ? require('helpers/dateFormat') : helpers.dateFormat;
    var routing         = (isGFFCtx) ? require('utils/routing') : require('../../../../../lib/routing');

    var hasUserValidators = function() {

        var _hasUserValidators = false, formsContext = null;
        // backend validation check
        if (!isGFFCtx) {
            // TODO - retrieve bakcend forms context
            formsContext = getContext('gina').forms || null;
        } else if (isGFFCtx &&  typeof(gina.forms) != 'undefined') {
            formsContext = gina.forms
        }
        if ( formsContext && typeof(formsContext.validators) != 'undefined' ) {
            _hasUserValidators = true
        }
        return _hasUserValidators;
    }
    /**@js_externs local*/
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
        'isJsonWebToken': 'Must be a valid JSON Web Token',
        'query': 'Must be a valid response',
        'isApiError': 'Condition not satisfied'
    };
    var self  = null;
    if (!data) {
        throw new Error('missing data param')
    } else {
        // cloning
        self  = merge( JSON.clone(data), self );
        local.data = merge( JSON.clone(data), local.data);
    }

    var getElementByName = function($form, name) { // frontend only
        var $foundElement   = null;
        for (let f in fieldsSet) {
            if (fieldsSet[f].name !== name) continue;

            $foundElement = new DOMParser()
                .parseFromString($form.innerHTML , 'text/html')
                .getElementById( fieldsSet[f].id );
            break;
        }
        if ($foundElement)
            return $foundElement;

        throw new Error('Field `'+ name +'` not found in fieldsSet');
    }

    /**
     * bufferToString - Convert Buffer to String
     * Will apply `Utf8Array` to `String`
     * @param {array} arrayBuffer
     */
    var bufferToString = function(arrayBuffer) {
        var out     = null
            , i     = null
            , len   = null
            , c     = null
        ;
        var char2 = null, char3 = null;

        out = '';
        len = arrayBuffer.length;
        i   = 0;
        while(i < len) {
            c = arrayBuffer[i++];
            switch (c >> 4) {
                case 0: case 1: case 2: case 3: case 4: case 5: case 6: case 7:
                    // 0xxxxxxx
                    out += String.fromCharCode(c);
                    break;
                case 12: case 13:
                    // 110x xxxx   10xx xxxx
                    char2 = arrayBuffer[i++];
                    out += String.fromCharCode(((c & 0x1F) << 6) | (char2 & 0x3F));
                    break;
                case 14:
                    // 1110 xxxx  10xx xxxx  10xx xxxx
                    char2 = arrayBuffer[i++];
                    char3 = arrayBuffer[i++];
                    out += String.fromCharCode(((c & 0x0F) << 12) |
                                ((char2 & 0x3F) << 6) |
                                ((char3 & 0x3F) << 0));
                    break;
            }
        }

        return out;
    };

    // TODO - One method for the front, and one for the server
    var queryFromFrontend = function(options, errorMessage) {
        var errors      = self[this['name']]['errors'] || {};
        var id          = this.target.id || this.target.getAttribute('id');


        // stop if
        //  - previous error detected
        if ( !self.isValid() ) {
            console.debug('stopping on errors ...');
            triggerEvent(gina, this.target, 'asyncCompleted.' + id, self[this['name']]);
            //return self[this.name];
            return;
        }

        var testedValue = this.target.dataset.ginaFormValidatorTestedValue;
        console.debug('[ '+ this['name'] +' ]', 'TESTED VALUE -> ' + this.value +' vs '+ testedValue);
        var _evt = 'asyncCompleted.' + id;
        var currentFormId = this.target.form.getAttribute('id');
        var cachedErrors = (
                            typeof(gina.validator) != 'undefined'
                            && typeof(gina.validator.$forms[currentFormId]) != 'undefined'
                            && typeof(gina.validator.$forms[currentFormId].cachedErrors) != 'undefined'
                        )
                        ? gina.validator.$forms[currentFormId].cachedErrors
                        : null;
        if ( !testedValue || typeof(testedValue) == 'undefined' || testedValue !== this.value ) {
            this.target.dataset.ginaFormValidatorTestedValue = this.value;
            // remove cachedErrors
            if (
                cachedErrors
                && typeof(cachedErrors[this.name]) != 'undefined'
                && typeof(cachedErrors[this.name].query) != 'undefined'
            ) {
                delete cachedErrors[this.name].query;
                if (
                    typeof(gina.validator.$forms[currentFormId]) != 'undefined'
                    &&
                    typeof(gina.validator.$forms[currentFormId].errors) != 'undefined'
                ) {
                    delete gina.validator.$forms[currentFormId].errors.query;
                }

            }
        } else if (testedValue === this.value) {
            // not resending to backend, but in case of cached errors, re display same error message
            var hasCachedErrors = false;
            if (
                cachedErrors
                && typeof(cachedErrors[this.name]) != 'undefined'
                && typeof(cachedErrors[this.name].query) != 'undefined'
                && typeof(cachedErrors[this.name].query[this.value]) != 'undefined'
            ) {
                this.error = errorMessage = cachedErrors[this.name].query[this.value].slice(0);
                hasCachedErrors = true;
            }
            errors['query'] = replace( this.error || errorMessage || local.errorLabels['query'], this);

            if (hasCachedErrors) {
                this['errors'] = errors;
                this.valid = false;
            }
            // Do not remove this test
            if ( typeof( gina.events[_evt]) != 'undefined' ) {
                triggerEvent(gina, this.target, _evt, self[this['name']]);
            }

            return self[this.name];
        }
        //console.debug('Did not return !!!');

        var xhr = null, _this = this;
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

        // forcing to sync mode
        var queryOptions = { isSynchrone: false, headers: {} };
        var queryData = options.data || null, strData = null;
        var isInlineValidation = (/^true$/i.test(this.target.form.dataset.ginaFormLiveCheckEnabled)) ? true : false; // TRUE if liveCheckEnabled

        // replace placeholders by field values
        strData = JSON.stringify(queryData);
        if ( /\$/.test(strData) ) {
            var variables = strData.match(/\$[-_\[\]a-z 0-9]+/g) || [];
            var value = null, key = null;
            for (let i = 0, len = variables.length; i < len; i++) {
                key = variables[i].replace(/\$/g, '');
                re = new RegExp("\\"+ variables[i].replace(/\[|\]/g, '\\$&'), "g");
                value = local.data[key] || null;
                if (!value && isInlineValidation) {
                    // Retrieving live value instead of using fieldsSet.value
                    value = getElementByName(this.target.form, key).value;
                }

                strData = strData.replace( re, value );
            }
        }
        // cleanup before sending
        queryData = strData.replace(/\\"/g, '');
        // TODO - support regexp for validIf
        var validIf = ( typeof(options.validIf) == 'undefined' ) ? true : options.validIf;

        queryOptions = merge(queryOptions, options, xhrOptions);
        delete queryOptions.data;
        delete queryOptions.validIf;

        var enctype = queryOptions.headers['Content-Type'];
        var result      = null
            , $target   = this.target
            //, id        = $target.getAttribute('id')
        ;
        id = $target.getAttribute('id')

        // checking url
        if (!/^http/.test(queryOptions.url) && /\@/.test(queryOptions.url) ) {
            try {
                var route = routing.getRoute(queryOptions.url);
                queryOptions.url = route.toUrl();
            } catch (routingError) {
                throw routingError;
            }
        }

        if ( queryOptions.withCredentials ) {
            if ('withCredentials' in xhr) {
                // XHR for Chrome/Firefox/Opera/Safari.
                if (queryOptions.isSynchrone) {
                    xhr.open(queryOptions.method, queryOptions.url, queryOptions.isSynchrone)
                } else {
                    xhr.open(queryOptions.method, queryOptions.url)
                }
            } else if ( typeof XDomainRequest != 'undefined' ) {
                // XDomainRequest for IE.
                xhr = new XDomainRequest();
                // if (queryOptions.isSynchrone) {
                //     xhr.open(queryOptions.method, queryOptions.url, queryOptions.isSynchrone);
                // } else {
                    xhr.open(queryOptions.method, queryOptions.url);
                // }
            } else {
                // CORS not supported.
                xhr = null;
                result = 'CORS not supported: the server is missing the header `"Access-Control-Allow-Credentials": true` ';
                //triggerEvent(gina, $target, 'error.' + id, result);
                throw new Error(result);
            }

            if ( typeof(queryOptions.responseType) != 'undefined' ) {
                /**
                 * Note: We expect to remove support for synchronous use of XMLHTTPRequest() during page unloads in Chrome in version 88,
                 * scheduled to ship in January 2021.
                 * The XMLHttpRequest2 spec was recently changed to prohibit sending a synchronous request when XMLHttpRequest.responseType
                 */
                xhr.responseType = queryOptions.responseType;
            } else {
                xhr.responseType = '';
            }

            xhr.withCredentials = true;
        } else {
            if (queryOptions.isSynchrone) {
                xhr.open(queryOptions.method, queryOptions.url, queryOptions.isSynchrone)
            } else {
                xhr.open(queryOptions.method, queryOptions.url)
            }
        }

        // setting up headers -    all but Content-Type ; it will be set right before .send() is called
        for (var hearder in queryOptions.headers) {
            if (hearder == 'Content-Type' && typeof (enctype) != 'undefined' && enctype != null && enctype != '')
                continue;

            xhr.setRequestHeader(hearder, queryOptions.headers[hearder]);
        }
        if (typeof (enctype) != 'undefined' && enctype != null && enctype != '') {
            xhr.setRequestHeader('Content-Type', enctype);
        }

        if (xhr) {

            xhr.onload = function () {

                var onResult = function(result) {

                    _this.value      = local['data'][_this.name] = (_this.value) ? _this.value.toLowerCase() : _this.value;

                    var isValid     = result.isValid || false;
                    if (validIf != isValid) {
                        isValid = false;
                    } else {
                        isValid = true;
                    }
                    self[_this['name']].valid = isValid;
                    var errors      = self[_this['name']]['errors'] || {};

                    var errorFields = ( typeof(result.error) != 'undefined' && typeof(result.fields) != 'undefined' ) ? result.fields : {};

                    if (errorFields.count() > 0 && !isValid || !isValid) {

                        if (!isValid) {
                            var systemError = null;
                            if ( typeof(errorFields[_this.name]) != 'undefined') {
                                local.errorLabels['query'] = errorFields[_this.name];
                            } else if ( typeof(result.error) != 'undefined' && /^5/.test(result.status) ) {
                                // system error
                                //console.debug('found system error: ', result);
                                systemError = result.error;
                            }
                            errors['query'] = replace(systemError || _this['error'] || options['error'] || local.errorLabels['query'],  _this);
                            console.debug('query error detected !! ', result);
                        }

                        if ( !errors['query'] && _this.value == '' ) {
                            isValid = true;
                        }
                    }

                    // if error tagged by a previous validation, remove it when isValid == true
                    if ( isValid && typeof(errors['query']) != 'undefined' ) {
                        delete errors['query'];
                    }

                    // To handle multiple errors from backend
                    // for (var f in errorFields.length) {
                    //     if ( !errors['query'] && _this.value == '' ) {
                    //         isValid = true;
                    //     }

                    //     if (!isValid) {
                    //         errors['query'] = replace(_this['error'] || local.errorLabels['query'], _this)
                    //     }
                    //     // if error tagged by a previous validation, remove it when isValid == true
                    //     else if ( isValid && typeof(errors['query']) != 'undefined' ) {
                    //         delete errors['query'];
                    //     }
                    // }

                    _this.valid = isValid;
                    var cachedErrors = gina.validator.$forms[_this.target.form.getAttribute('id')].cachedErrors || {};
                    if ( errors.count() > 0 ) {

                        _this['errors'] = errors;
                        if ( typeof(self[_this['name']].errors) == 'undefined' ) {
                            self[_this['name']].errors = {};
                        }

                        self[_this['name']].errors = merge(self[_this['name']].errors, errors);

                        if ( typeof(errors.query) != 'undefined' && errors.query ) {

                            if ( typeof(cachedErrors[_this.name]) == 'undefined' ) {
                                cachedErrors[_this.name] = {}
                            }
                            if ( typeof(cachedErrors[_this.name].query) == 'undefined' ) {
                                cachedErrors[_this.name].query = {}
                            }

                            cachedErrors[_this.name].query[_this.value] = errors.query.slice(0);
                        }

                        var errClass = _this.target.getAttribute('data-gina-form-errors');
                        if ( !/query/.test(errClass) ) {
                            if ( !errClass || errClass =='' ) {
                                errClass = 'query'
                            } else {
                                errClass +=' query'
                            }
                            _this.target.setAttribute('data-gina-form-errors', errClass);
                        }
                    } else if (
                        typeof(cachedErrors[_this.name]) != 'undefined'
                        && typeof(cachedErrors[_this.name].query) != 'undefined'
                        && typeof(cachedErrors[_this.name].query[_this.value]) != 'undefined'
                    ) {
                        delete cachedErrors[_this.name].query[_this.value];
                    }

                    var id = _this.target.id || _this.target.getAttribute('id');
                    console.debug('prematurely completed event `'+ 'asyncCompleted.' + id +'`');
                    return triggerEvent(gina, _this.target, 'asyncCompleted.' + id, self[_this['name']]);
                }

                try {
                    result = this.responseText;
                    var contentType     = this.getResponseHeader("Content-Type");
                    if ( /\/json/.test( contentType ) ) {
                        result = JSON.parse(this.responseText);

                        if ( typeof(result.status) == 'undefined' )
                            result.status = this.status;

                        //triggerEvent(gina, $target, 'success.' + id, result);
                        return onResult(result)
                    } else {
                        result = { 'status': xhr.status, 'message': '' };
                        if ( /^(\{|\[)/.test( xhr.responseText ) ) {
                            try {
                                result = merge( result, JSON.parse(xhr.responseText) );
                            } catch (err) {
                                result = merge(result, err);
                            }
                        }
                        return onResult(result);
                    }
                } catch (err) {
                    throw err;
                }
            }

            if (data) {
                xhr.send( queryData ); // stringyfied
            }  else {
                xhr.send();
            }
        }
    }

    /**
     * queryFromBackend
     *
     *
     * @param {object} options
     * @param {object} request
     * @param {object} response
     * @param {callback} next
     *
     *
     */
    var queryFromBackend = async function(options, request, response, next) {
        var Config = require(_(GINA_FRAMEWORK_DIR +'/core/config.js', true));
        var config      = new Config().getInstance();

        var opt     = null
            //appConf.proxy.<bundle>;
            , rule  = null
            , bundle = null
            , currentBundle = getContext('bundle')
        ;
        // trying to retrieve proxy conf
        if ( /\@/.test(options.url) ) {
            var attr = options.url.split(/@/);
            rule = attr[0];
            bundle = attr[1];
            var proxyConf = getConfig( currentBundle, 'app' ).proxy;
            try {
                if (config.bundle !== bundle) { // ignore if same bundle
                    // getting proxy conf when available
                    opt = getConfig( currentBundle, 'app' ).proxy[bundle];
                }
            } catch (proxyError) {
                throw new Error('Could not retrieve `proxy` configuration for bundle `'+ bundle +'`. Please check your `/config/app.json`.\n'+proxyError.stack);
            }

            attr = null;
        } else {
            // TODO - handle else; when it is an external domain/url
            throw new Error('external url/domain not  handled at this moment, please contact us if you need support for it.')
        }
        var route       = JSON.clone(routing.getRoute(options.url, options.data));
        var env         = config.env;
        var conf        = config[bundle][env];
        if (!opt) { // setup opt by default if no proxy conf found
            if (config.bundle == bundle) {
                var credentials = getConfig( currentBundle, 'settings' ).server.credentials;
                options.ca = credentials.ca || null;
                options.hostname    = conf.server.scheme +'://'+ conf.host;
                options.port        = conf.port[conf.server.protocol][conf.server.scheme];
                options.protocol    = conf.server.protocol;
                options.rejectUnauthorized  = false;
            }
            opt = {
                "ca"        : options.ca,
                "hostname"  : options.hostname,
                "port"      : options.port,
                "path"      : options.path
            };

            if ( typeof(options.protocol) != 'undefined' ) {
                opt.protocol = options.protocol
            }
            if ( typeof(options.rejectUnauthorized) != 'undefined' ) {
                opt.rejectUnauthorized = options.rejectUnauthorized
            }
        }

        /**
         * BO routing configuration
         * Attention: this portion of code is from `router.js`
         * Any modification on this part must be reflected on `router.js`
         */
        // default param setting
         var params = {
            method              : route.method,
            requirements        : route.requirements,
            namespace           : route.namespace || undefined,
            url                 : unescape(route.url), /// avoid %20
            rule                : rule + '@' + bundle,
            param               : JSON.clone(route.param),
            middleware          : JSON.clone(route.middleware),
            bundle              : route.bundle,
            isXMLRequest        : request.isXMLRequest,
            isWithCredentials   : request.isWithCredentials
        };

        var templateName = params.rule.replace('\@'+ bundle, '') || '_common';
        var routeHasViews = ( typeof(conf.content.templates) != 'undefined' ) ? true : false;
        var controllerOptions = {
            // view namespace first
            template: (routeHasViews) ? conf.content.templates[templateName] || conf.content.templates._common : undefined,
            // namespace       : params.param.namespace || namespace,
            //control         : route.param.control,
            // controller      : controllerFile,
            //controller: '<span class="gina-bundle-name">' + bundle +'</span>/controllers/controller.js',
            //file: route.param.file, // matches rule name by default
            //bundle          : bundle,//module
            // bundlePath      : conf.bundlesPath + '/' + bundle,
            // rootPath        : self.executionPath,
            // We don't want to keep original conf untouched
            conf            : JSON.clone(conf),
            //instance: self.serverInstance,
            //template: (routeHasViews) ? conf.content.templates[templateName] : undefined,
            //isUsingTemplate: local.isUsingTemplate,
            cacheless: conf.cacheless //,
            //path: params.param.path || null, // user custom path : namespace should be ignored | left blank
            //assets: {}
        };

        controllerOptions = merge(controllerOptions, params);

        // BO - Template outside of namespace fix added on 2021-08-19
        // We want to keep original conf untouched
        controllerOptions.conf = JSON.clone(conf);
        controllerOptions.conf.content.routing[controllerOptions.rule].param = params.param;
        // inheriting from _common
        if (
            controllerOptions.template
            && typeof(controllerOptions.template.ginaLoader) == 'undefined'
        ) {
            controllerOptions.template.ginaLoader = controllerOptions.conf.content.templates._common.ginaLoader;
        }
        controllerOptions.conf.content.routing[controllerOptions.rule].param = params.param;
        delete controllerOptions.middleware;
        delete controllerOptions.param;
        delete controllerOptions.requirements;
        // EO - Template outside of namespace
        /**
         * EO routing configuration
         */

        var Controller = require(_(GINA_FRAMEWORK_DIR +'/core/controller/controller.js'), true);
        var controller = new Controller(controllerOptions);
        controller.name = route.param.control;
        //controller.serverInstance = serverInstance;
        controller.setOptions(request, response, next, controllerOptions);


        var data = ( typeof(options.data) == 'object' && options.data.count() > 0 )
                ? options.data
                : {};
        // inherited data from current query asking for validation
        var urlParams = '';
        if ( /^get|delete|put$/i.test(options.method) ) {
            urlParams += '?';
            var i = 0;
            for (let p in data) {
                if (i > 0) {
                    urlParams += '&';
                }
                let val = (typeof(data[p]) == 'object') ? encodeURIComponent(JSON.stringify(data[p])) : data[p];
                urlParams += p +'='+ val;
                i++;
            }
        }
        opt.method  = options.method;
        //opt.path    = route.url + urlParams;
        opt.path    = route.url;

        var util            = require('util');
        var promisify       = util.promisify;
        var result = { isValid: false }, err = false;

        await promisify(controller.query)(opt, data)
            .then(function onResult(_result) {
                result = _result;
            })
            .catch(function onResultError(_err) {
                err = _err;
            });
        if (err) {
            //throw err;
            console.error(err);
            result.error = err;
        }
        return result;
    };

    /**
     * query
     */
    var query = null;
    if (isGFFCtx) {
        query = queryFromFrontend;
    } else {
        query = queryFromBackend;
    }


    /**
     * addField
     * Add field to the validation context
     * @param {string} el
     * @param {string|boolean|number|object} [value]
     */
    var addField = function(el, value) {
        var val = null, label = null;

        if ( typeof(self[el]) == 'undefined' && typeof(value) != 'undefined' ) {
            self[el] = val = value;
        }

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
            'target': (isGFFCtx && typeof($fields) != 'undefined') ? $fields[el] : null,
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
            var isValid     = false;
            var alias       = ( typeof(window) != 'undefined' && typeof(window._currentValidatorAlias) != 'undefined' ) ? window._currentValidatorAlias : 'is';
            if ( typeof(window) != 'undefined'  && window._currentValidatorAlias)
                delete window._currentValidatorAlias;

            var errors      = self[this['name']]['errors'] || {};
            local.data[this.name] = self[this.name].value;

            if (
                typeof(errors['isRequired']) == 'undefined'
                && this.value == ''
                && !/^false$/i.test(this.value)
                && this.value != 0
                ||
                !errors['isRequired']
                && this.value == ''
                && !/^false$/i.test(this.value)
                && this.value != 0
            ) {
                isValid = true;
            } else if (!errors['isRequired'] && typeof(this.value) == 'string' && this.value == '') {
                isValid = true;
            }

            if ( !isValid && /^(true|false)$/i.test(condition) ) { // because it can be evaluated on backend validation
                isValid = condition;
            } else if (!isValid) {
                var re = null, flags = null;
                // Fixed on 2021-03-13: $variable now replaced with real value beafore validation
                if ( /[\!\=>\>\<a-z 0-9]+/i.test(condition) ) {
                    var variables = condition.match(/\${0}[-_,.\[\]a-z0-9]+/ig); // without space(s)
                    if (variables && variables.length > 0) {
                        var compiledCondition = condition;
                        for (var i = 0, len = variables.length; i < len; ++i) {
                            // $varibale comparison
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
                    }
                } else if ( condition instanceof RegExp ) {

                    isValid = condition.test(this.value) ? true : false;

                } else if( typeof(condition) == 'boolean') {

                    isValid = (condition) ? true : false;

                } else {
                    try {
                        // TODO - motif /gi to pass to the second argument
                        if ( /\/(.*)\//.test(condition) ) {
                            re = condition.match(/\/(.*)\//).pop();
                            flags = condition.replace('/' + re + '/', '');

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
                errors[alias] = replace(this.error || errorMessage || local.errorLabels[alias], this);
                if ( typeof(errorStack) != 'undefined' )
                    errors['stack'] = errorStack;
            }
            // if error tagged by a previous vlaidation, remove it when isValid == true
            else if ( isValid && typeof(errors[alias]) != 'undefined' ) {
                delete errors[alias];
                //delete errors['stack'];
            }

            this.valid = isValid;
            if ( errors.count() > 0 )
                this['errors'] = errors;


            return self[this.name]
        }

        self[el]['set'] = function(value) {
            this.value  = local['data'][this.name] = value;
            //  html
            this.target.setAttribute('value', value);
            // Todo : select and radio case to apply change

            return self[this.name]
        }

        self[el]['isEmail'] = function() {


            this.value      = local['data'][this.name] = (this.value) ? this.value.toLowerCase() : this.value;
            // Apply on current field upper -> lower
            if (
                isGFFCtx
                && this.target
                && this.target.value != ''
                && /[A-Z]+/.test(this.target.value)
            ) {
                this.target.value = this.value;
            }


            var rgx         = /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
            var isValid     = rgx.test(this['value']) ? true : false;
            var errors      = self[this['name']]['errors'] || {};

            if ( !errors['isRequired'] && this.value == '' ) {
                isValid = true;
            }

            if (!isValid) {
                errors['isEmail'] = replace(this['error'] || local.errorLabels['isEmail'], this)
            }
            // if error tagged by a previous vlaidation, remove it when isValid == true
            else if ( isValid && typeof(errors['isEmail']) != 'undefined' ) {
                delete errors['isEmail'];
                //delete errors['stack'];
            }

            this.valid = isValid;

            if ( errors.count() > 0 )
                this['errors'] = errors;

            return self[this['name']]
        }

        self[el]['isJsonWebToken'] = function() {


            this.value      = local['data'][this.name] = (this.value) ? this.value.toLowerCase() : this.value;
            // Apply on current field upper -> lower
            if (
                isGFFCtx
                && this.target
                && this.target.value != ''
                && /[A-Z]+/.test(this.target.value)
            ) {
                this.target.value = this.value;
            }

            var rgx         = /^[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*$/;
            var isValid     = rgx.test(this['value']) ? true : false;
            var errors      = self[this['name']]['errors'] || {};

            if ( !errors['isRequired'] && this.value == '' ) {
                isValid = true;
            }

            if (!isValid) {
                errors['isJsonWebToken'] = replace(this['error'] || local.errorLabels['isJsonWebToken'], this)
            }
            // if error tagged by a previous vlaidation, remove it when isValid == true
            else if ( isValid && typeof(errors['isJsonWebToken']) != 'undefined' ) {
                delete errors['isJsonWebToken'];
                //delete errors['stack'];
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

            if ( errors['isRequired'] && this.value == false) {
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

            var isValid = (val !== null) ? true : false;

            if (!isValid) {
                errors['isBoolean'] = replace(this.error || local.errorLabels['isBoolean'], this)
            }
            // if error tagged by a previous vlaidation, remove it when isValid == true
            else if ( isValid && typeof(errors['isBoolean']) != 'undefined' ) {
                delete errors['isBoolean'];
                //delete errors['stack'];
            }

            this.valid = isValid;
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
         *  @returns {object} result
         * */
        self[el]['isNumber'] = function(minLength, maxLength) {
            var val             = this.value
                , len           = 0
                , isValid       = false
                , isMinLength   = true
                , isMaxLength   = true
                , errors        = self[this['name']]['errors'] || {}
            ;

            // test if val is a number
            try {
                // if val is a string replaces comas by points
                if ( typeof(val) == 'string' && /\,|\./g.test(val) ) {
                    val = local.data[this.name] = this.value = parseFloat( val.replace(/,/g, '.').replace(/\s+/g, '') );
                } else if ( typeof(val) == 'string' && val != '') {
                    val = local.data[this.name] = this.value = parseInt( val.replace(/\s+/g, '') );
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
            // if error tagged by a previous vlaidation, remove it when isValid == true
            if ( isValid && typeof(errors['isNumberLength']) != 'undefined') {
                delete errors['isNumberLength'];
            }

            this.valid = isValid;
            val = this.value = local.data[this.name] = ( val != '' ) ? Number(val) : val;
            if ( errors.count() > 0 )
                this['errors'] = errors;

            return self[this.name]
        }

        self[el]['toInteger'] = function() {
            var val = this.value
                , errors = self[this['name']]['errors'] || {}
            ;

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
                , errors        = self[this['name']]['errors'] || {}
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
                    //local.data[this.name] = this.value;
                    // if (isGFFCtx) {
                    //     //this.target.setAttribute('value', this.value);
                    //     document.getElementById(this.target.id).value = this.value;
                    //     //triggerEvent(gina, this.target, 'change', self[this['name']]);
                    // }

                } else {
                    this.value = this.value.replace(/\,/g,'');
                }
            }

            var val         = local.data[this.name] = this.value
                , errors    = self[this['name']]['errors'] || {}
                , isValid   = true
            ;

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
                        if (isGFFCtx)
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

            var val         = local.data[this.name] = this.value
                , isValid   = false
                , errors    = self[this['name']]['errors'] || {}
            ;


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

                // is in excluded ?
                var excludedIndex = local.excluded.indexOf(this.name);
                if ( excludedIndex > -1 ) {
                    local.excluded.splice(excludedIndex, 1);
                }

                return self[this.name]
            }

            // radio group case
            if (
                isGFFCtx
                && this.target
                && this.target.tagName == 'INPUT'
                && typeof(this.target.type) != 'undefined'
                && this.target.type == 'radio'
            ) {
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
            var errors  = self[this['name']]['errors'] || {};


            if (!isValid) {
                errors['isRequired'] = replace(this.error || local.errorLabels['isRequired'], this)
            }
            // if error tagged by a previous vlaidation, remove it when isValid == true
            else if ( isValid ) {
                if (typeof(errors['isRequired']) != 'undefined' )
                    delete errors['isRequired'];
                //delete errors['stack'];
                // if ( typeof(self[this.name]['errors']) != 'undefined' && typeof(self[this.name]['errors']['isRequired']) != 'undefined' )
                //     delete self[this.name]['errors']['isRequired'];
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
         * NB.:
         * In your JSON rule ;
         * {
         *  "password": {
         *      "isRequired": true,
         *
         *      "isString": true // Means that we just want a string and we don't care of its length
         *      // OR
         *      "isString": 7 // Means at least 7 chars length
         *      // OR
         *      "isString": [7, 40] // Means at least 7 chars length and maximum 40 chars length
         *      // OR
         *      "isString": [7] // Means is strickly equal to 7 chars length, same as [7,7]
         *  }
         * }
         * @param {number|undefined} [ minLength ]
         * @param {number} [ maxLength ]
         * */
        self[el]['isString'] = function(minLength, maxLength) {

            var val             = local.data[this.name] = this.value
                , isValid       = false
                , isMinLength   = true
                , isMaxLength   = true
                , errors        = self[this['name']]['errors'] || {}
            ;


            // test if val is a string
            if ( typeof(val) == 'string' ) {
                //isValid = true;

                if ( !errors['isRequired'] && val != '' ) {
                    isValid = true;
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
            if ( errors.count() > 0 ) {
                this['errors'] = errors;
            }

            return self[this.name]
        }

        /**
         * Check if date
         *
         * @param {string|boolean} [mask] - by default "yyyy-mm-dd"
         *
         * @returns {date} date - extended by gina::utils::dateFormat; an adaptation of Steven Levithan's code
         * */
        self[el]['isDate'] = function(mask) {
            var val         = this.value
                , isValid   = false
                , errors    = self[this['name']]['errors'] || {}
                , m         = null
                , date      = null
            ;
            // Default validation on livecheck & invalid init value
            if (!val || val == '' || /NaN|Invalid Date/i.test(val) ) {
                if ( /NaN|Invalid Date/i.test(val) ) {
                    console.warn('[FormValidator::isDate] Provided value for field `'+ this.name +'` is not allowed: `'+ val +'`');
                    errors['isDate'] = replace(this.error || local.errorLabels['isDate'], this);

                }
                this.valid = isValid;
                if ( errors.count() > 0 )
                    this['errors'] = errors;

                return self[this.name];
            }

            if (
                typeof(mask) == 'undefined'
                ||
                typeof(mask) != 'undefined' && /true/i.test(mask)
            ) {
                mask = "yyyy-mm-dd"; // by default
            }

            if (val instanceof Date) {
                date = val.format(mask);
            } else {

                try {
                    m = mask.match(/[^\/\- ]+/g);
                } catch (err) {
                    throw new Error('[FormValidator::isDate] Provided mask not allowed: `'+ mask +'`');
                }

                try {
                    val = val.match(/[^\/\- ]+/g);
                    var dic = {}, d, len;
                    for (d=0, len=m.length; d<len; ++d) {
                        dic[m[d]] = val[d]
                    }
                    var formatedDate = mask;
                    for (var v in dic) {
                        formatedDate = formatedDate.replace(new RegExp(v, "g"), dic[v])
                    }
                } catch (err) {
                    throw new Error('[FormValidator::isDate] Provided value not allowed: `'+ val +'`' + err);
                }


                date = this.value = local.data[this.name] = new Date(formatedDate);

                if ( /Invalid Date/i.test(date) || date instanceof Date === false ) {
                    if ( !errors['isRequired'] && this.value == '' ) {
                        isValid = true
                    } else {
                        errors['isDate'] = replace(this.error || local.errorLabels['isDate'], this);
                    }

                    this.valid = isValid;
                    if ( errors.count() > 0 )
                        this['errors'] = errors;

                    return self[this.name]
                }
                isValid = true;
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
                //if ( typeof(this.value) == 'string' ) {
                    this.value = this.value.replace(/^\s+|\s+$/, '');
                    local.data[this.name] = local.data[this.name] = this.value;
                //}
                return self[this.name]
            }
        }

        /**
         * Exclude when converting back to datas
         *
         * @returns {object} data
         * */
        self[el]['exclude'] = function(isApplicable) {

            if ( typeof(isApplicable) == 'boolean' && !isApplicable ) {

                if ( /^true|false$/i.test(this.value)) {
                    this.value = (/^true$/i.test(this.value)) ? true : false;
                    local.data[this.name] = this.value;
                }

                return self[this.name]
            }
            this.isExcluded = false;
            // list field to be purged
            if ( local.excluded.indexOf(this.name) < 0) {
                local.excluded.push(this.name);
                this.isExcluded = true;
            }


            // remove existing errors
            return self[this.name];
        }
        /**
         * Validation through API call
         * Try to put this rule at the end to prevent sending
         * a request to the remote host if previous rules failed
         */
        self[el]['query'] = query;


        self[el]['getValidationContext'] = function() {
            return {
                'isGFFCtx'  : isGFFCtx,
                'self'      : self,
                'local'     : local,
                'replace'   : replace
            }
        }
        // Merging user validators
        // To debug, open inspector and look into `Extra Scripts`
        if ( hasUserValidators() ) {
            var userValidator = null, filename = null;
            try {
                for (let v in gina.forms.validators) {
                    filename = '/validators/'+ v + '/main.js';
                    // setting default local error
                    local.errorLabels[v] = 'Condition not satisfied';
                    // converting Buffer to string
                    if ( isGFFCtx ) {
                        //userValidatorError = String.fromCharCode.apply(null, new Uint16Array(gina.forms.validators[v].data));
                        userValidator = bufferToString(gina.forms.validators[v].data); // ok
                        var passedContext = 'var validationContext = this.getValidationContext(),isGFFCtx = validationContext.isGFFCtx,self = validationContext.self,local = validationContext.local,replace = validationContext.replace;';
                        userValidator = userValidator.replace(/(\)\s+\{|\)\{){1}/, '$&\n\t'+ passedContext);

                        //userValidator += '\n//#sourceURL='+ v +'.js';
                    } else {
                        userValidator = gina.forms.validators[v].toString();
                    }

                    self[el][v] = eval('(' + userValidator + ')\n//# sourceURL='+ v +'.js');
                    //self[el][v] = Function('errorMessage', 'errorStack', userValidator);
                }
            } catch (userValidatorError) {
                throw new Error('[UserFormValidator] Could not evaluate: `'+ filename +'`\n'+userValidatorError.stack);
            }
        }
    } // EO addField(el, value)


    for (let el in self) {
        // Adding fields & validators to context
        addField(el, self[el]);
    }

    self['addField'] = function(el, value) {
        if ( typeof(self[el]) != 'undefined' ) {
            return
        }
        addField(el, value);
    };


    // self['getExcludedFields'] = function() {
    //     return local.excluded;
    // };

    /**
     * Check if errors found during validation
     *
     * @returns {boolean}
     * */
    self['isValid'] = function() {
        return (self['getErrors']().count() > 0) ? false : true;
    }
    self['setErrors'] = function(errors) {
        if (!errors) {
            return {}
        }
        for (var field in self) {
            if ( typeof(self[field]) != 'object' ) {
                continue
            }
            // if ( typeof(self[field]['errors']) == 'undefined' || self[field]['errors'].count() == 0 ) {
            //     delete errors[field];
            //     continue;
            // }
            // if ( typeof(errors[field]) == 'undefined' ) {
            //     continue;
            // }
            for (var r in self[field]) {
                // no error for the current field rule
                if (
                    typeof(errors[field]) != 'object'
                    ||
                    typeof(errors[field][r]) == 'undefined'
                ) {
                    continue;
                }


                if (
                    typeof(self[field].valid) != 'undefined'
                    && /^true$/i.test(self[field].valid)
                ) {
                    delete errors[field][r];
                    continue;
                }


                if ( typeof( self[field]['errors']) == 'undefined' ) {
                    self[field]['errors'] = {}
                }

                self[field]['errors'][r] = errors[field][r];
            }

            // if field does not have errors, remove errors[field]
            if (
                typeof(self[field]['errors']) == 'undefined'
                    && typeof(errors[field]) != 'undefined'
                ||
                typeof(self[field]['errors']) != 'undefined'
                    && self[field]['errors'].count() == 0
                    && typeof(errors[field]) != 'undefined'
            ) {
                delete errors[field];
                continue;
            }
        }
        return errors;
    }
    /**
     * getErrors
     * NB.: This portion is shared between the front & the back
     *
     * @param {string} [fieldName]
     *
     * @returns errors
     */
    self['getErrors'] = function(fieldName) {
        var errors = {};

        if ( typeof(fieldName) != 'undefined' ) {
            if ( typeof(self[fieldName]) != 'undefined' && self[fieldName] && typeof(self[fieldName]['errors']) != 'undefined' && self[fieldName]['errors'].count() > 0 ) {
                errors[fieldName] = self[fieldName]['errors'];
            }
            return errors
        }

        for (var field in self) {
            if (
                typeof(self[field]) != 'object'
            ) {
                continue;
            }

            if ( typeof(self[field]['errors']) != 'undefined' ) {
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
        // local.data = JSON.parse(JSON.stringify(local.data).replace(/\"(true|false)\"/gi, '$1'))
        return local.data
    }

    /**@js_externs replace*/
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
/*
 * This file is part of the gina package.
 * Copyright (c) 2009-2023 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * Routing
 *
 * @package     Gina.Lib
 * @namespace   Gina.Lib.Routing
 * @author      Rhinostone <contact@gina.io>
 * */

function Routing() {

    var isGFFCtx    = ((typeof (module) !== 'undefined') && module.exports) ? false :  true;
    var self        = {
        allowedMethods: ['get', 'post', 'put', 'delete'],
        reservedParams: ['controle', 'file','title', 'namespace', 'path'],
        notFound: {}
    };

    self.allowedMethodsString   = self.allowedMethods.join(',');

    // loading utils & plugins
    var plugins = null, inherits = null, merge = null, Validator = null, fs = null, promisify = null;
    if (!isGFFCtx) {
        fs          = require('fs');
        promisify   = require('util').promisify;
        inherits    = require('../../inherits');
        merge       = require('../../merge');
        plugins     = require(__dirname+'/../../../core/plugins') || getContext('gina').plugins;
        Validator   = plugins.Validator;

    }
    // BO - In case of partial rendering whithout handler defined for the partial
    else {
        if ( !merge || typeof(merge) != 'function' ) {
            var merge = require('utils/merge');
        }
        if ( !Validator || typeof(Validator) != 'function' ) {
            var Validator = require('utils/form-validator');
        }
    }
    // EO - In case of partial rendering whithout handler defined for the partial

    /**
     * Get url props
     * Used to retrieve additional properties for routes with redirect flag for example
     *
     * @param {string} [bundle]
     * @param {string} [env]
     *
     * @returns {object} urlProps - { .host, .hostname, .webroot }
     */
    self.getUrlProps = function(bundle, env) {
        var config = null, urlProps = {}, _route = null;
        if (isGFFCtx) {
            // TODO - add support to get from env
            config = window.gina.config;
            // by default
            urlProps.hostname = config.hostname;
            if ( typeof(bundle) != 'undefined' ) {
                // get from webroot
                _route = routing.getRoute('webroot@'+ bundle);
                urlProps.hostname   = _route.hostname;
                urlProps.host       = _route.host;
                urlProps.webroot    = _route.webroot;
            }
        } else {
            config = getContext('gina').config;
            if ( typeof(getContext('argvFilename')) != 'undefined' ) {
                config.getRouting = getContext('gina').Config.instance.getRouting
            }
            if ( typeof(bundle) == 'undefined' ) {
                bundle      = config.bundle;
            }
            if ( typeof(env) == 'undefined' ) {
                env      = config.env;
            }

            urlProps.hostname   = config.envConf[bundle][env].hostname;
            urlProps.host       = config.envConf[bundle][env].host;
            urlProps.webroot    = config.envConf[bundle][env].server.webroot;
        }

        return urlProps;
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
    // self.loadBundleRoutingConfiguration = function(options, filename) {

    // }

    /**
     * Get routing
     *
     * @param {string} [bundle]
     */
    // self.getRouting = function(bundle) {

    // }

    /**
     * Get reversed routing
     *
     * @param {string} [bundle]
     */
    // self.getReverseRouting = function(bundle) {

    // }

    /**
     * Compare urls
     *
     * @param {object} params - Route params containing the given url to be compared with
     * @param {string|array} url - routing.json url
     * @param {object} [request]
     * @param {object} [response] - only used for query validation
     * @param {object} [next] - only used for query validation
     *
     * @returns {object|false} foundRoute
     * */
    self.compareUrls = async function(params, url, request, response, next) {

        if ( typeof(request) == 'undefined' ) {
            request = { routing: {} };
        }
        // Sample debug break for specific rule
        // if ( params.rule == 'my-specific-rule@bundle' ) {
        //     console.debug('passed '+ params.rule);
        // }
        if ( /\,/.test(url) ) {
            var i               = 0
                , urls          = url.split(/\,/g)
                , len           = urls.length
                , foundRoute    = {
                    past: false,
                    request: request
                };


            while (i < len && !foundRoute.past) {
                foundRoute = await parseRouting(params, urls[i], request, response, next);
                ++i;
            }

            return foundRoute;
        } else {
            return await parseRouting(params, url, request, response, next);
        }
    };

    /**
     * Check if rule has params
     *
     * @param {string} pathname
     * @returns {boolean} found
     *
     * @private
     * */
    var hasParams = function(pathname) {
        return (/:/.test(pathname)) ? true : false;
    };

    /**
     * Parse routing for mathcing url
     *
     * @param {object} params - `params` is the same `request.routing` that can be retried in controller with: req.routing
     * @param {string} url
     * @param {object} request
     * @param {object} [response] - Only used for query validation
     * @param {object} [next] - Only used for query validation
     *
     * @returns {object} foundRoute
     *
     * */
    var parseRouting = async function(params, url, request, response, next) {

        // Sample debug break for specific rule
        // if ( params.rule == 'my-specific-rule@bundle' ) {
        //     console.debug('passed '+ params.rule);
        // }

        var uRe             = params.url.split(/\//)
            , uRo           = url.split(/\//)
            , uReCount      = 0
            , uRoCount      = 0
            , maxLen        = uRo.length
            , score         = 0
            , foundRoute    = {}
            , i             = 0
            , method        = request.method.toLowerCase()
        ;

        // TODO - remove comments
        // when requirement is not listed but still validated
        // if (
        //     typeof(params.requirements) != 'undefined'
        //     && method == params.method.toLowerCase()
        //     //&& /validator\:\:/.test(JSON.stringify(params.requirements))
        // ) {

        //     var requiremements = Object.getOwnPropertyNames(params.requirements);
        //     var r = 0;
        //     // In order to filter variables
        //     var uRoVars = uRo.join(',').match(/\:[-_a-z0-9]+/g);
        //     // var uRoVarCount = (uRoVars) ? uRoVars.length : 0;
        //     while ( r < requiremements.length ) {

        //         // if not listed, but still needing validation
        //         if (
        //             typeof(params.param[ requiremements[r] ]) == 'undefined'
        //             && /^validator\:\:/i.test(params.requirements[ requiremements[r] ])
        //             && typeof(request[method][ requiremements[r] ])
        //         ) {
        //             if (uRo.length != uRe.length) {
        //                 // r++;
        //                 // continue;
        //                 break;
        //             }
        //             // updating uRoVars
        //             uRoVars = uRo.join(',').match(/\:[-_a-z0-9]+/g);
        //             /**
        //              * "requirements" : {
        //              *      "email": "validator::{ isEmail: true, isString: [7] }"
        //              *  }
        //              *
        //              * e.g.: result = new Validator('routing', _data, null, {email: {isEmail: true, subject: \"Anything\"}} ).isEmail().valid;
        //              */
        //             let regex = params.requirements[ requiremements[r] ];
        //             let _data = {}, _ruleObj = {}, _rule = {};

        //             try {
        //                 _ruleObj    = JSON.parse(
        //                 regex.split(/::/).splice(1)[0]
        //                     .replace(/([^\:\"\s+](\w+))\:/g, '"$1":') // { query: { validIf: true }} => { "query": { "validIf": true }}
        //                     .replace(/([^\:\"\s+](\w+))\s+\:/g, '"$1":') // note the space between `validIf` & `:` { query: { validIf : true }} => { "query": { "validIf": true }}
        //                 );
        //             } catch (err) {
        //                 throw err;
        //             }

        //             let key     = requiremements[r];
        //             // validator.query case
        //             if (typeof(_ruleObj.query) != 'undefined' && typeof(_ruleObj.query.data) != 'undefined') {
        //                 _data = _ruleObj.query.data;
        //                 // filter _data vs uRoVars by removing from data those not present in uRoVars
        //                 for (let k in _data) {
        //                     if ( uRoVars.indexOf(_data[k]) < 0 ) {
        //                         delete _data[k]
        //                     }
        //                 }
        //                 for (let p = 0, pLen = uRo.length; p < pLen; p++) {
        //                     // :variable only
        //                     if (!/^\:/.test(uRo[p])) continue;

        //                     let pName = uRo[p].replace(/^\:/, '');
        //                     if ( pName != '' && typeof(uRe[p]) != 'undefined' ) {
        //                         _data[ pName ] = uRe[p];
        //                         // Updating params
        //                         if ( typeof(request.params[pName]) == 'undefined' ) {
        //                             // Set in case it is not found
        //                             request.params[pName] = uRe[p];
        //                         }
        //                     }
        //                 }
        //             }
        //             // normal case
        //             _data = merge(_data, request[method]);

        //             if ( typeof(_data[key]) == 'undefined' ) {
        //                 // init default value for unlisted variable/param
        //                 _data[key] = null;
        //             }

        //             _rule[key]  = _ruleObj;
        //             _validator  = new Validator('routing', _data, null, _rule );

        //             if (_ruleObj.count() == 0 ) {
        //                 console.error('Route validation failed '+ params.rule);
        //                 return false;
        //             }

        //             for (let rule in _ruleObj) {
        //                 let _result = null;
        //                 if (Array.isArray(_ruleObj[rule])) { // has args
        //                     _result = await _validator[key][rule].apply(_validator[key], _ruleObj[rule]);
        //                 } else {
        //                     _result = await _validator[key][rule](_ruleObj[rule], request, response, next);
        //                 }
        //                 //let condition = _ruleObj[rule].validIf.replace(new RegExp('\\$isValid'), _result.isValid);
        //                 // if ( eval(condition)) {
        //                 if ( !_result.isValid ) {
        //                     --score;
        //                 }
        //             }
        //         }
        //         r++
        //     }
        // }

        // attaching routing description for this request
        var paramMethod = params.method.toLowerCase();

        var hasAlreadyBeenScored = false;
        if (
            typeof(params.requirements) != 'undefined'
            && /get|delete/i.test(method)
            && typeof(request[method]) != 'undefined'
            ||
            // GET request is in fact in this case a DELETE request
            typeof(params.requirements) != 'undefined'
            && /get/i.test(method)
            && /delete/i.test(paramMethod)
        ) {
            if ( /get/i.test(method) && /delete/i.test(paramMethod) ) {
                method = paramMethod;
            }
            // `delete` methods don't have a body
            // So, request.delete is {} by default
            if ( /^(delete)$/i.test(method) && uRe.length === uRo.length ) {
                // just in case
                if ( typeof(request[method]) == 'undefined' ) {
                    request[method] = {};
                }
                for (let p = 0, pLen = uRo.length; p < pLen; p++) {
                    if (uRe[p] === uRo[p]) {
                        ++score;
                        continue;
                    }
                    let _key = uRo[p].substr(1);
                    if ( typeof(params.requirements[_key]) == 'undefined' ) {
                        continue;
                    }
                    let condition = params.requirements[_key];
                    if ( /^\//.test(condition) ) {
                        condition = condition.substr(1, condition.lastIndexOf('/')-1);
                    } else if ( /^validator\:\:/.test(condition) && await fitsWithRequirements(uRo[p], uRe[p], params, request, response, next) ) {
                        ++score;
                        continue;
                    }
                    if (
                        /^:/.test(uRo[p])
                        && typeof(condition) != 'undefined'
                        && new RegExp(condition).test(uRe[p])
                    ) {
                        ++score;
                        request[method][uRo[p].substr(1)] = uRe[p];
                    }
                }
                hasAlreadyBeenScored = true;
            }

            // Sample debug break for specific rule
            // if ( params.rule == 'my-specific-rule@bundle' ) {
            //     console.debug('passed '+ params.rule);
            // }
            for (let p in request[method]) {
                if ( typeof(params.requirements[p]) != 'undefined' && uRo.indexOf(':' + p) < 0 ) {
                    uRo[uRoCount] = ':' + p;
                    ++uRoCount;

                    uRe[uReCount] = request[method][p];
                    ++uReCount;
                    if (!hasAlreadyBeenScored && uRe.length === uRo.length)
                        ++maxLen;
                }
            }
        }


        // Sample debug break for specific rule
        // if ( params.rule == 'my-specific-rule@bundle' ) {
        //     console.debug('passed '+ params.rule);
        // }

        if (!hasAlreadyBeenScored && uRe.length === uRo.length) {

            for (; i < maxLen; ++i) {

                if (uRe[i] === uRo[i]) {
                    ++score;
                }
                else if (score == i && hasParams(uRo[i]) && await fitsWithRequirements(uRo[i], uRe[i], params, request, response, next)) {
                    ++score;
                }
            }
        }

        // This test is done to catch `validator::` rules under requirements
        if (
            typeof(params.requirements) != 'undefined'
            && method == params.method.toLowerCase()
            && !hasAlreadyBeenScored
            && score >= maxLen
        ) {

            var requiremements = Object.getOwnPropertyNames(params.requirements);
            var r = 0;
            // In order to filter variables
            var uRoVars = uRo.join(',').match(/\:[-_a-z0-9]+/g);
            // var uRoVarCount = (uRoVars) ? uRoVars.length : 0;
            while ( r < requiremements.length ) {
                // requirement name as `key`
                let key = requiremements[r];
                // if not listed, but still needing validation
                if (
                    typeof(params.param[ key ]) == 'undefined'
                    && /^validator\:\:/i.test(params.requirements[ key ])
                ) {
                    if (uRo.length != uRe.length) {
                        // r++;
                        // continue;
                        break;
                    }
                    // updating uRoVars
                    uRoVars = uRo.join(',').match(/\:[-_a-z0-9]+/g);
                    /**
                     * "requirements" : {
                     *      "email": "validator::{ isEmail: true, isString: [7] }"
                     *  }
                     *
                     * e.g.: result = new Validator('routing', _data, null, {email: {isEmail: true, subject: \"Anything\"}} ).isEmail().valid;
                     */
                    let regex = params.requirements[ key ];
                    let _data = {}, _ruleObj = {}, _rule = {};

                    try {
                        _ruleObj    = JSON.parse(
                        regex.split(/::/).splice(1)[0]
                            .replace(/([^\:\"\s+](\w+))\:/g, '"$1":') // { query: { validIf: true }} => { "query": { "validIf": true }}
                            .replace(/([^\:\"\s+](\w+))\s+\:/g, '"$1":') // note the space between `validIf` & `:` { query: { validIf : true }} => { "query": { "validIf": true }}
                        );
                    } catch (err) {
                        throw err;
                    }

                    // validator.query case
                    if (typeof(_ruleObj.query) != 'undefined' && typeof(_ruleObj.query.data) != 'undefined') {
                        _data = _ruleObj.query.data;
                        // filter _data vs uRoVars by removing from data those not present in uRoVars
                        for (let k in _data) {
                            if ( uRoVars.indexOf(_data[k]) < 0 ) {
                                delete _data[k]
                            }
                        }
                        for (let p = 0, pLen = uRo.length; p < pLen; p++) {
                            // :variable only
                            if (!/^\:/.test(uRo[p])) continue;

                            let pName = uRo[p].replace(/^\:/, '');
                            if ( pName != '' && typeof(uRe[p]) != 'undefined' ) {
                                _data[ pName ] = uRe[p];
                                // Updating params
                                if ( typeof(request.params[pName]) == 'undefined' ) {
                                    // Set in case if not found
                                    request.params[pName] = uRe[p];
                                }
                            }
                        }
                    }

                    // If validator.query has data, _data should inherit from request data
                    _data = merge(_data, JSON.clone(request[method]) || {} );
                    // This test is to initialize query.data[key] to null by default
                    if ( typeof(_data[key]) == 'undefined' ) {
                        // init default value for unlisted variable/param
                        _data[key] = null;
                    }

                    _rule[key]  = _ruleObj;
                    if (!isGFFCtx) {
                        _validator  = new Validator('routing', _data, null, _rule );
                    } else {
                        _validator  = new Validator(_data);
                    }

                    if (_ruleObj.count() == 0 ) {
                        console.error('Route validation failed '+ params.rule);
                        --score;
                        r++;
                        continue;
                    }
                    // for each validation rule
                    for (let rule in _ruleObj) {
                        // updating query.data
                        if (typeof(_ruleObj[rule].data) != 'undefined') {
                            _ruleObj[rule].data = _data;
                        }
                        let _result = null;
                        if (Array.isArray(_ruleObj[rule])) { // has args
                            _result = await _validator[key][rule].apply(_validator[key], _ruleObj[rule]);
                        } else {
                            _result = await _validator[key][rule](_ruleObj[rule], request, response, next);
                        }

                        //let condition = _ruleObj[rule].validIf.replace(new RegExp('\\$isValid'), _result.isValid);
                        // if ( eval(condition)) {
                        if ( !_result.isValid ) {
                            --score;
                            if ( typeof(_result.error) != 'undefined' ) {
                                throw _result.error;
                            }
                        }
                    }
                }
                r++
            }
        }

        foundRoute.past     = (score === maxLen) ? true : false;

        if (foundRoute.past) {
            // attaching routing description for this request
            //request.routing = params; // can be retried in controller with: req.routing
            // && replacing placeholders
            request.routing = checkRouteParams(params, request[method]);
            foundRoute.request  = request;
        }


        return foundRoute;
    };

    /**
     * Fits with requiremements
     * This is for server side use only
     * http://en.wikipedia.org/wiki/Regular_expression
     *
     * @param {string} urlVar
     * @param {string} urlVal
     * @param {object} params
     *
     * @returns {boolean} true|false - `true` if it fits
     *
     * @private
     * */
    var fitsWithRequirements = async function(urlVar, urlVal, params, request, response, next) {
        // Sample debug break for specific rule
        // if ( params.rule == 'my-specific-rule@bundle' ) {
        //     console.debug('passed '+ params.rule);
        // }
        //var isValid = new Validator('routing', { email: "contact@gina.io"}, null, {email: {isEmail: true}} ).isEmail().valid;
        var matched     = -1
            , _param    = urlVar.match(/\:\w+/g)
            , regex     = new RegExp(urlVar, 'g')
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
            // request method
            , requestMethod        = request.method.toLowerCase()
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
        // if (params.param.file && regex.test(params.param.file)) {
        //     params.param.file = params.param.file.replace(regex, urlVal);
        // }
        // file is handle like url replacement (path is like pathname)
        if (typeof (params.param.file) != 'undefined' && /:/.test(params.param.file)) {
            var _regex = new RegExp('(:'+urlVar+'/|:'+urlVar+'$)', 'g');
            replacement.variable = urlVal;
            params.param.file = params.param.file.replace( _regex, replacement );
        }

        //  if custom title, title rewrite
        if (params.param.title && regex.test(params.param.title)) {
            params.param.title = params.param.title.replace(regex, urlVal);
        }

        if (_param.length == 1) { // fast one

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
            if (params.method.toLowerCase() !== requestMethod) return false;

            if ( typeof(request[requestMethod]) == 'undefined' ) {
                request[requestMethod] = {}
            }

            key     = _param[matched].substr(1);
            // escaping `\` characters
            // TODO - remove comment : all regex requirement must start with `/`
            //regex   = ( /\\/.test(params.requirements[key]) ) ? params.requirements[key].replace(/\\/, '') : params.requirements[key];
            regex = params.requirements[key];
            if (/^\//.test(regex)) {
                re      = regex.match(/\/(.*)\//).pop();
                flags   = regex.replace('/' + re + '/', '');

                tested  = new RegExp(re, flags).test(urlVal)
            } else if ( /^validator\:\:/.test(regex) && urlVal) {
                /**
                 * "requirements" : {
                 *      "id" : "/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i",
                 *      "email": "validator::{ isEmail: true, isString: [7] }"
                 *  }
                 *
                 * e.g.: tested = new Validator('routing', _data, null, {email: {isEmail: true, subject: \"Anything\"}} ).isEmail().valid;
                 */
                _data = {}; _ruleObj = {}; _rule = {}; str = '';
                urlVar.replace( new RegExp('[^'+ key +']','g'), function(){ str += arguments[0] });
                _data[key]  = urlVal.replace( new RegExp(str, 'g'), '');
                try {
                    //_ruleObj    = JSON.parse(regex.split(/::/).splice(1)[0].replace(/([^\W+ true false])+(\w+)/g, '"$&"'));
                    _ruleObj    = JSON.parse(
                    regex.split(/::/).splice(1)[0]
                        .replace(/([^\:\"\s+](\w+))\:/g, '"$1":') // { query: { validIf: true }} => { "query": { "validIf": true }}
                        .replace(/([^\:\"\s+](\w+))\s+\:/g, '"$1":') // note the space between `validIf` & `:` { query: { validIf : true }} => { "query": { "validIf": true }}
                    );
                } catch (err) {
                    throw err;
                }
                //_ruleObj    = JSON.parse(regex.split(/::/).splice(1)[0].replace(/([^\W+ true false])+(\w+)/g, '"$&"'));
                if (typeof(_ruleObj.query) != 'undefined' && typeof(_ruleObj.query.data) != 'undefined') {
                    // since we only have one param
                    // :var1 == :var1
                    if ( urlVar == _ruleObj.query.data[ Object.keys(_ruleObj.query.data)[0] ] ) {
                        _ruleObj.query.data[ Object.keys(_ruleObj.query.data)[0] ] = _data[key];
                        // Set in case it is not found
                        request.params[key] = _data[key];
                    }
                }
                _rule[key]  = _ruleObj;
                _validator  = new Validator('routing', _data, null, _rule );
                if (_ruleObj.count() == 0 ) {
                    console.error('Route validation failed '+ params.rule);
                    return false;
                }
                for (let rule in _ruleObj) {
                    if (Array.isArray(_ruleObj[rule])) { // has args
                        await _validator[key][rule].apply(_validator[key], _ruleObj[rule]);
                    } else {
                        await _validator[key][rule](_ruleObj[rule], request, response, next);
                    }
                }
                tested = _validator.isValid();
            } else {
                tested = new RegExp(params.requirements[key]).test(urlVal);
            }

            if (
                typeof(params.param[key]) != 'undefined' &&
                typeof(params.requirements) != 'undefined' &&
                typeof(params.requirements[key]) != 'undefined' &&
                typeof(request.params) != 'undefined' &&
                tested
            ) {
                request.params[key] = urlVal;
                if ( typeof(request[requestMethod][key]) == 'undefined' ) {
                    request[requestMethod][key] = urlVal;
                }
                return true;
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

                        for (let rule in _ruleObj) {
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

    var replacement = function(matched){
        return ( /\/$/.test(matched) ? replacement.variable+ '/': replacement.variable )
    };
    var checkRouteParams = function(route, params) {
        var variable        = null
            , regex         = null
            , urls          = null
            , i             = null
            , len           = null
            , rawRouteUrl   = route.url
            , p             = null
            , pLen          = null
        ;
        for (p in route.param) {
            if ( typeof(params) != 'undefined' && typeof(params[p]) == 'undefined' ) continue;

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
                    // file is handle like url replacement (path is like pathname)
                    if (typeof (route.param.file) != 'undefined' && /:/.test(route.param.file)) {
                        replacement.variable = params[variable];
                        route.param.file = route.param.file.replace( regex, replacement );
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

        // Selecting url in case of multiple urls & optional requirmements
        if ( urls ) {
            i = 0; len = urls.length;
            var rawUrlVars = null
                , rawUrlScore = null
                , rawUrls = rawRouteUrl.split(/\,/g)
                , pKey = null
                , lastScore = 0
            ;
            route.urlIndex = 0; // by default
            for (; i < len; ++i) {
                rawUrlScore = 0;
                rawUrlVars = rawUrls[0].match(/\:[-_a-z0-9]+/ig);
                if ( !rawUrlVars ) continue;
                p = 0;
                pLen = rawUrlVars.length;
                for (; p < pLen; p++) {
                    pKey = rawUrlVars[p].substr(1);
                    if ( typeof(params[ pKey ]) != 'undefined' && params[ pKey ] ) {
                        rawUrlScore++;
                    }
                }
                // We just rely in params count for now
                if (rawUrlScore > lastScore) {
                    lastScore = rawUrlScore;
                    route.urlIndex = i;
                }
            }
        }

        return route;
    }

    /**
     * @function getRoute
     *
     * @param {string} rule e.g.: [ <scheme>:// ]<name>[ @<bundle> ][ /<environment> ]
     * @param {object} params
     * @param {number} [urlIndex] in case you have more than one url registered for the current route, you can select the one you want to use. Default is 0.
     *
     * @returns {object} route
     * */
    self.getRoute = function(rule, params, urlIndex) {

        var config = null;
        if (isGFFCtx) {
            config = window.gina.config;
        } else {
            config = getContext('gina').config;
            if ( typeof(getContext('argvFilename')) != 'undefined' ) {
                config.getRouting = getContext('gina').Config.instance.getRouting;
            }
        }

        var env         = config.env || GINA_ENV  // by default, takes the current bundle
            , envTmp    = null
            //, scheme    = null
            , bundle    = config.bundle // by default, takes the current bundle
        ;

        if ( !/\@/.test(rule) && typeof(bundle) != 'undefined' && bundle != null) {
            rule = rule.toLowerCase()
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

            rule = arr[0].toLowerCase() +'@'+ bundle;
        }


        var routing = config.getRouting(bundle, env);

        if ( typeof(routing[rule]) == 'undefined' ) {
            throw new Error('[ RoutingHelper::getRouting(rule, params) ] : `' +rule + '` not found !')
        }

        var route = JSON.clone(routing[rule]);
        var variable    = null
            , regex     = null
            , urls      = null
            , i         = null
            , len       = null
            , msg       = null
        ;
        route = checkRouteParams(route, params);

        if ( /\,/.test(route.url) ) {
            if ( typeof(route.urlIndex) != 'undefined' ) {
                urlIndex = route.urlIndex; // set by checkRouteParams(route, params)
                delete route.urlIndex;
            }
            urlIndex = ( typeof(urlIndex) != 'undefined' ) ? urlIndex : 0;
            route.url = route.url.split(/,/g)[urlIndex];
        }
        // fix url in case of empty param value allowed by the routing rule
        // to prevent having a folder.
        // eg.: {..., id: '/^\\s*$/'} => {..., id: ''} => /path/to/ becoming /path/to
        if ( /\/$/.test(route.url) && route.url != '/' )
            route.url = route.url.substr(0, route.url.length-1);

        // Completeting url with extra params e.g.: ?param1=val1&param2=val2
        if ( /GET/i.test(route.method) && typeof(params) != 'undefined' ) {
            var queryParams = '?', maskedUrl = routing[rule].url;
            //self.reservedParams;
            for (let r in route.param) {
                if ( self.reservedParams.indexOf(r) > -1 || new RegExp(route.param[r]).test(maskedUrl) )
                    continue;
                if (typeof(params[r]) != 'undefined' )
                    queryParams += r +'='+ encodeURIComponent(params[r])+ '&';
            }

            if (queryParams.length > 1) {
                queryParams = queryParams.substring(0, queryParams.length-1);
                route.url += queryParams;
            }
        }

        // recommanded for x-bundle coms
        // leave `ignoreWebRoot` empty or set it to false for x-bundle coms
        route.toUrl = function (ignoreWebRoot) {

            var urlProps = null;
            if ( /^redirect$/i.test(this.param.control) ) {
                urlProps = self.getUrlProps(this.bundle, (env||GINA_ENV));
            }

            var wroot       = this.webroot || urlProps.webroot
                , hostname  = this.hostname || urlProps.hostname
                , path      = this.url
            ;

            this.url = ( typeof(ignoreWebRoot) != 'undefined' && ignoreWebRoot == true ) ? path.replace(wroot, '/') : path;

            return hostname + this.url
        };

        /**
         * request current url
         *
         *
         *
         * @param {boolean} [ignoreWebRoot]
         * @param {object} [options] - see: https://nodejs.org/api/https.html#https_new_agent_options
         * @param {object} [_this] - current context: only used when `promisify`is used
         *
         * @callback {callback} [cb] - see: https://nodejs.org/api/https.html#https_new_agent_options
         *      @param {object} res
         */
        route.request = function(ignoreWebRoot, options) {

            var cb = null, _this = null;
            if ( typeof(arguments[arguments.length-1]) == 'function' ) {
                cb = arguments[arguments.length-1];
            }
            if ( typeof(arguments[2]) == 'object' ) {
                _this = arguments[2];
            }

            var wroot       = this.webroot || _this.webroot
                , hostname  = this.hostname || _this.hostname
                , url       = ( typeof(ignoreWebRoot) != 'undefined' && ignoreWebRoot == true ) ? path.replace(wroot, '/') : this.url || _this.url
            ;

            var scheme = ( /^https/.test(hostname) ) ? 'https' : 'http';

            if (isGFFCtx) {
                var target = ( typeof(options) != 'undefined' && typeof(options.target) != 'undefined' ) ? options.target : "_self";
                window.open(url, target)
            } else {
                if ( typeof(options.agent) == 'undefined' ) {
                    // See.: https://nodejs.org/api/http.html#http_class_http_agent
                    // create an agent just for this request
                    options.agent = false;
                }
                var agent = require(''+scheme);
                var onAgentResponse = function(res) {

                    var data = '', err = false;

                    res.on('data', function (chunk) {
                        data += chunk;
                    });
                    res.on('error', function (error) {
                        err = 'Failed to get mail content';
                        if (error && typeof(error.stack) != 'undefined' ) {
                            err += error.stack;
                        } else if ( typeof(error) == 'string' ) {
                            err += '\n' + error;
                        }
                    });
                    res.on('end', function () {
                        if (/^\{/.test(data) ) {
                            try {
                                data = JSON.parse(data);
                                if (typeof(data.error) != 'undefined') {
                                    err = JSON.clone(data);
                                    data = null;
                                }
                            } catch(parseError) {
                                err = parseError
                            }
                        }
                        if (err) {
                            cb(err);
                            return;
                        }

                        cb(false, data);
                        return;
                    });
                }
                if (cb) {
                    agent.get(url, options, onAgentResponse);
                } else {
                    // just throw the request without waiting/handling response
                    agent.get(url, options);
                }
            }
            return;

        } // EO route.request()

        if ( /\:/.test(route.url) ) {
            var paramList = route.url
                                .match(/(\:(.*)\/|\:(.*)$)/g)
                                .map(function(el){  return el.replace(/\//g, ''); }).join(', ');
            msg = '[ RoutingHelper::getRoute(rule[, bundle, method]) ] : route [ %r ] param placeholder not defined: `' + route.url + '` !\n Check your route description to compare requirements against param variables [ '+ paramList +']';
            msg = msg.replace(/\%r/, rule);
            var err = new Error(msg);
            console.warn( err );
            // Do not throw error nor return here !!!
        }

        return route
    };

    var getFormatedRoute = function(route, url, hash) {
        // fix url in case of empty param value allowed by the routing rule
        // to prevent having a folder.
        // eg.: {..., id: '/^\\s*$/'} => {..., id: ''} => /path/to/ becoming /path/to
        if ( /\/$/.test(url) && url != '/' )
            url = url.substr(0, url.length-1);
        // adding hash if found
        if (hash)
            url += hash;

        route.url = url;
        // recommanded for x-bundle coms
        // leave `ignoreWebRoot` empty or set it to false for x-bundle coms
        route.toUrl = function (ignoreWebRoot) {
            var wroot       = this.webroot
                , hostname  = this.hostname
                , path      = this.url
            ;

            this.url = ( typeof(ignoreWebRoot) != 'undefined' && ignoreWebRoot == true ) ? path.replace(wroot, '/') : path;

            return hostname + this.url
        };

        return route
    }

    /**
     * Get route by url
     * N.B.: this will only work with rules declared with `GET` method property
     *
     * @function getRouteByUrl
     *
     * @param {string} url e.g.: /webroot/some/url/path or http
     * @param {string} [bundle] targeted bundle
     * @param {string} [method] request method (GET|PUT|PUT|DELETE) - GET is set by default
     * @param {object} [request]
     * @param {boolean} [isOverridinMethod] // will replace request.method by the provided method - Used for redirections
     *
     * @returns {object|boolean} route - when route is found; `false` when not found
     * */

    self.getRouteByUrl = function (url, bundle, method, request, isOverridinMethod) {

        if (
            arguments.length == 2
            && typeof(arguments[1]) != 'undefined'
            && self.allowedMethods.indexOf(arguments[1].toLowerCase()) > -1
        ) {
            method = arguments[1];
            bundle = undefined;
        }
        var webroot             = null
            , route             = null
            , routing           = null
            , reverseRouting    = null
            , hash              = null // #section nav
            , hostname          = null
            , host              = null
        ;

        if ( /\#/.test(url) && url.length > 1 ) {
            var urlPart = url.split(/\#/);
            url     = urlPart[0];
            hash    = '#' + urlPart[1];

            urlPart = null;
        }

        // fast method
        if (
            arguments.length == 1
            && typeof(arguments[0]) != 'undefined'
        ) {
            if ( !/^(https|http)/i.test(url) && !/^\//.test(url)) {
                url = '/'+ url;
            }

            webroot = '/' + url.split(/\//g)[1];
            if (isGFFCtx) {
                reverseRouting  = gina.config.reverseRouting;
                routing         = gina.config.routing
            }
            // get bundle
            if ( typeof(reverseRouting[webroot]) != 'undefined' ) {
                var infos = routing[ reverseRouting[webroot] ];
                bundle      = infos.bundle;
                webroot     = infos.webroot;
                host        = infos.host;
                hostname    = infos.hostname;
                infos       = null;
            }
        }

        isOverridinMethod = ( typeof(arguments[arguments.length-1]) != 'boolean') ? false : arguments[arguments.length-1];

        var matched             = false
            , config            = null
            , env               = null
            , prefix            = null
            , pathname          = null
            , params            = null
            , isRoute           = null
            , foundRoute        = null
            , routeObj          = null
        ;



        var isMethodProvidedByDefault = ( typeof(method) != 'undefined' ) ? true : false;

        if (isGFFCtx) {
            config          = window.gina.config;
            bundle          = (typeof (bundle) != 'undefined') ? bundle : config.bundle;
            env             = config.env;
            routing         = routing || config.getRouting(bundle);
            reverseRouting  = reverseRouting || config.reverseRouting;
            isXMLRequest    = ( typeof(isXMLRequest) != 'undefined' ) ? isXMLRequest : false; // TODO - retrieve the right value

            hostname        = hostname || config.hostname;
            webroot         = webroot || config.webroot;
            prefix          = hostname + webroot;

            request = {
                routing: {},
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
                    routing: {},
                    isXMLRequest: false,
                    method : ( typeof(method) != 'undefined' ) ? method.toLowerCase() : 'get',
                    params: {},
                    url: url
                }
            }
            if (isOverridinMethod) {
                request.method = method;
            }
            isXMLRequest    = request.isXMLRequest || false;
        }

        pathname    = url.replace( new RegExp('^('+ hostname +'|'+hostname.replace(/\:\d+/, '') +')' ), '');
        if ( typeof(request.routing.path) == 'undefined' )
            request.routing.path = unescape(pathname);
        method      = ( typeof(method) != 'undefined' ) ? method.toLowerCase() : 'get';

        if (isMethodProvidedByDefault) {
            // to handle 303 redirect like PUT -> GET
            request.originalMethod = request.method;

            request.method = method;
            request.routing.path = unescape(pathname)
        }
        // last method check
        if ( !request.method)
            request.method = method;

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
                    middleware          : JSON.clone(routing[name].middleware),
                    bundle              : routing[name].bundle,
                    isXMLRequest        : isXMLRequest
                };

                // normal case
                //Parsing for the right url.
                try {

                    isRoute = self.compareUrls(params, routing[name].url, request);

                    if (isRoute.past) {

                        route = JSON.clone(routing[name]);
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
                var urlHasChanged = false;
                if (
                    url == '#'
                    && /GET/i.test(method)
                    && isMethodProvidedByDefault
                    || /^404\:/.test(url)
                ) {
                    url = location.pathname;
                    urlHasChanged = true;
                }

                if ( typeof(self.notFound) == 'undefined' ) {
                    self.notFound = {}
                }

                var notFound = null, msg = '[ RoutingHelper::getRouteByUrl(rule[, bundle, method]) ] : route [ %r ] is called but not found inside your view: `' + url + '` !';
                if ( gina.hasPopinHandler && gina.popinIsBinded ) {
                    notFound = gina.popin.getActivePopin().target.innerHTML.match(/404\:\[\w+\][a-z 0-9-_@]+/);
                } else {
                    notFound = document.body.innerHTML.match(/404\:\[\w+\][a-z 0-9-_@]+/);
                }

                notFound = (notFound && notFound.length > 0) ? notFound[0] : null;

                if ( notFound && isMethodProvidedByDefault && urlHasChanged ) {

                    var m = notFound.match(/\[\w+\]/)[0];

                    notFound = notFound.replace('404:'+m, m.replace(/\[|\]/g, '')+'::' );

                    msg = msg.replace(/\%r/, notFound.replace(/404\:\s+/, ''));

                    if (typeof(self.notFound[notFound]) == 'undefined') {
                        self.notFound[notFound] = {
                            count: 1,
                            message: msg
                        };
                    } else if ( isMethodProvidedByDefault && typeof(self.notFound[notFound]) != 'undefined' ) {
                        ++self.notFound[notFound].count;
                    }

                    return false
                }

                notFound = null;

                var altRule = gina.config.reverseRouting[url] || null;
                if (
                    !notFound
                    && altRule
                    && typeof(altRule) != 'undefined'
                    && altRule.split(/\@(.+)$/)[1] == bundle
                ) {

                    notFound = altRule;
                    if ( typeof(self.notFound[notFound]) == 'undefined' ) {

                        msg = msg.replace(/\%r/, method.toUpperCase() +'::'+ altRule);

                        self.notFound[notFound] = {
                            count: 1,
                            message: msg
                        };
                        //console.warn(msg);
                    } else if ( isMethodProvidedByDefault && typeof(self.notFound[notFound]) != 'undefined' ) {
                        ++self.notFound[notFound].count;
                    }

                    return false
                }

                // forms
                var altRoute = self.compareUrls(params, url, request) || null;
                if(altRoute.past && isMethodProvidedByDefault) {
                    notFound = method.toUpperCase() +'::'+ altRoute.request.routing.rule;
                    if ( typeof(self.notFound[notFound]) == 'undefined' ) {
                        msg = msg.replace(/\%r/, notFound);
                        //console.warn(msg);
                    } else {
                        ++self.notFound[notFound].count;
                    }

                    return false
                }
                return false
            }


            console.warn( new Error('[ RoutingHelper::getRouteByUrl(rule[, bundle, method, request]) ] : route not found for url: `' + url + '` !').stack );
            return false;
        } else {
            // fix url in case of empty param value allowed by the routing rule
            // to prevent having a folder.
            // eg.: {..., id: '/^\\s*$/'} => {..., id: ''} => /path/to/ becoming /path/to
            if ( /\/$/.test(url) && url != '/' )
                url = url.substr(0, url.length-1);
            // adding hash if found
            if (hash)
                url += hash;

            route.url = url;
            // recommanded for x-bundle coms
            // leave `ignoreWebRoot` empty or set it to false for x-bundle coms
            route.toUrl = function (ignoreWebRoot) {
                var wroot       = this.webroot
                    , hostname  = this.hostname
                    , path      = this.url
                ;

                this.url = ( typeof(ignoreWebRoot) != 'undefined' && ignoreWebRoot == true ) ? path.replace(wroot, '/') : path;

                return hostname + this.url
            };

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
    define('utils/routing', ['require', 'utils/form-validator', 'utils/merge'], function() { return Routing() })
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
    var dateFormat  = dateFormat || require('helpers/dateFormat');


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
            var tmpCollections  = JSON.clone(collections);
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
     * @returns {array} result
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
     * @returns {array} result
     * */
    function collectionDelete(filter) {

        if ( typeof(filter) !== 'object' ) {
            throw new Error('filter must be an object');
        } else {
            var content     = JSON.clone( collections[ this['_collection'] ] )
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
    var merge       = require('utils/merge'); //require('../../../../../lib/merge');
    var Collection  = require('utils/collection'); //require('../../../../../lib/collection');
    var uuid        = require('uuid');

    module.exports = StoragePlugin

} else if ( typeof(define) === 'function' && define.amd) {
    // Publish as AMD module
    define('gina/storage', ['helpers/dateFormat', 'helpers/prototypes'],function() { return StoragePlugin })
};
/**
 * Operations on selectors
 * */

function insertAfter(referenceNode, newNode) {
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
}

/*
 * DOMParser HTML extension
 * 2012-09-04
 *
 * By Eli Grey, http://eligrey.com
 * Public domain.
 *
 * Added in gina on: 2020-12-12
 *
 */

/*! @source https://gist.github.com/1129031 */
/*global document, DOMParser*/
(function(DOMParser) {
	"use strict";

	var proto = DOMParser.prototype,
        nativeParse = proto.parseFromString;

	// Firefox/Opera/IE trigger errors for unsupported types
	try {
		// WebKit returns null for unsupported types
		if ((new DOMParser()).parseFromString("", "text/html")) {
			// text/html natvely supported
			return;
		}
	} catch (ex) {}

	proto.parseFromString = function(markup, type) {
		if (/^\s*text\/html\s*(?:;|$)/i.test(type)) {
			var doc = document.implementation.createHTMLDocument("");

			if (markup.toLowerCase().indexOf('<!doctype') > -1) {
				doc.documentElement.innerHTML = markup;
			}
			else {
				doc.body.innerHTML = markup;
			}
			return doc;
		} else {
			return nativeParse.apply(this, arguments);
		}
	};
}(DOMParser));
define("utils/dom", function(){});

/**
 * ValidatorPlugin
 *
 * Dependencies:
 *  - utils/form-validator
 *  - utils/merge
 *  - utils/events
 *  - vendor/uuid
 *
 * Additional helpers for the backend are located in framwework/v{version}/helpers/plugins/validator-*.js
 *
 *  At Form Level
 *      - data-gina-form-live-check-enabled
 *      - data-gina-form-required-before-submit
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
    var events      = [
        'init', // form or popin init
        'ready',
        'registered',
        'success',
        'error',
        'progress',
        'submit',
        'reset',
        'change',
        'changed',
        'keydown', // for autocomplete
        'keyup', // for autocomplete
        'focusout',
        'focusin',
        'validate', // for form livecheck (validation)
        'validated', // for form livecheck (validation)
        'destroy',
        'asyncCompleted'
    ];

    // See: https://developer.mozilla.org/fr/docs/Web/HTML/Element/Input
    var allowedLiveInputTypes = [
        'radio',
        'checkbox',

        'text',
        'hidden',
        'password',
        'number', // not supporting float
        'date',
        'email',
        // extended types
        'search',
        'color',
        'tel',
        'range',
        'time',
        'datetime-local',
        'datetime', // deprecated
        'month',
        'week',
        'url'
    ];

    /** imports */
    var isGFFCtx        = ( ( typeof(module) !== 'undefined' ) && module.exports ) ? false : true;
    var envIsDev        = null;
    if (isGFFCtx) {
        require('utils/events');
        registerEvents(this.plugin, events);

        require('utils/dom');
        require('utils/effects');

        envIsDev = gina.config.envIsDev;
    } else {
        envIsDev   = (/^true$/i.test(process.env.NODE_ENV_IS_DEV)) ? true : false;
        if (envIsDev) {
            delete require.cache[require.resolve('./form-validator')]
        }
    }

    var uuid            = (isGFFCtx) ? require('vendor/uuid') : require('uuid');
    var merge           = (isGFFCtx) ? require('utils/merge') : require('../../../../../lib/merge');
    var inherits        = (isGFFCtx) ? require('utils/inherits') : require('../../../../../lib/inherits');
    var FormValidator   = (isGFFCtx) ? require('utils/form-validator') : require('./form-validator');
    //var Collection      = (isGFFCtx) ? require('utils/collection') : require('../../../../../lib/collection');
    var routing         = (isGFFCtx) ? require('utils/routing') : require('../../../../../lib/routing');

    /** definitions */
    var instance    = {
        'id'                : 'validator-' + uuid.v4(),

        'plugin'            : this.plugin,
        'on'                : (isGFFCtx) ? on : null,
        'eventData'         : {},
        'target'            : (isGFFCtx) ? document : null, // by default
        'errors'            : {},
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
        'cachedErrors'          : {},
        'binded'                : false,
        'unbinded'              : false,
        'withUserBindings'      : false,
        'rules'                 : {},
        'setOptions'            : null,
        'send'                  : null,
        'isValidating'          : null,
        'isSubmitting'          : null,
        'submit'                : null,
        'destroy'               : null,
        'resetErrorsDisplay'    : null,
        'resetFields'           : null
    };
    /**@js_externs local*/
    var local = {
        'rules': {}
    };

    var keyboardMapping = {};

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
                customRule = checkForRulesImports(customRule);
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
                rules = checkForRulesImports(rules);
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
        options = merge(options, xhrOptions);
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
            initForm( document.getElementById(_id) );
        }

        if ( typeof(instance.$forms[_id]) != 'undefined' ) {
            instance['$forms'][_id].withUserBindings = true;

            if ( typeof(this.$forms) != 'undefined' && typeof(this.$forms[_id]) == 'undefined' ) {
                $form = this.$forms[_id] = instance['$forms'][_id];
            } else {
                $form = instance.$forms[_id];
            }
        }

        if (!$form) {
            throw new Error('Validator::getFormById(...) exception: could not retrieve form `'+ _id +'`');
        }

        if ( !$form.binded) {
            var $target = $form.target;
            bindForm($target);
            $form = instance.$forms[_id];
        }



        // update toolbar
        if ( envIsDev && isGFFCtx && typeof(window.ginaToolbar) != 'undefined' && window.ginaToolbar ) {
            // update toolbar
            if (!gina.forms.errors)
                gina.forms.errors = {};

            var objCallback = {
                id      : _id,
                rules   : instance.$forms[_id].rules
            };
            if ( typeof(instance.$forms[_id].errors) != 'undefined' ) {
                objCallback.errors = instance.$forms[_id].errors
            }

            window.ginaToolbar.update('forms', objCallback);
        }

        return $form;
    }

    /**
     * isPopinContext
     *
     * @returns {boolean} isPopinContext
     */
    var isPopinContext = function() {
        var isPopinInUse = false, $activePopin = null;

        if ( gina.hasPopinHandler && gina.popinIsBinded ) {
            $activePopin = gina.popin.getActivePopin();
        }

        if ( $activePopin && $activePopin.isOpen ) {
            isPopinInUse = true;
        }

        return isPopinInUse;
    }


    /**
     * validateFormById
     *
     * @param {string} formId
     * @param {object} [customRule]
     *
     * @returns {object} $form
     * */
    var validateFormById = function(formId, customRule) {
        var $form = null
            , _id = formId
            , rules = ( typeof(local.rules.count() > 0 ) ) ? local.rules : instance.rules
            , $target = null
        ;

        if ( !instance['$forms'] ) {
            throw new Error('`$forms` collection not found')
        }
        // Return existing when available
        if ( typeof(_id) != 'undefined' && typeof(instance.$forms[_id]) != 'undefined' ) {
            return instance.$forms[_id];
        }

        if ( typeof(_id) == 'undefined' ) {
            if ( typeof(this.id) != 'undefined' && this.id != '' && this.id != null ) {
                _id = this.id
            } else {
                throw new Error('[ FormValidator::validateFormById(formId, customRule) ] `formId` is missing')
            }
        }

        if ( typeof(_id) == 'string') {
            _id = _id.replace(/\#/, '')
        } else if ( typeof(_id) == 'object' && !Array.isArray(_id) ) { // weird exception

            $target = _id.form;
            _id = $target.getAttribute('id') || 'form.'+uuid.v4();

            $target.setAttribute('id', _id);// just in case

        } else {
            throw new Error('[ FormValidator::validateFormById(formId[, customRule]) ] `formId` should be a `string`');
        }

        checkForDuplicateForm(_id);

        if ( typeof(this.$forms) != 'undefined' && typeof(instance['$forms'][_id]) != 'undefined' ) {
            $form   = this.$forms[_id] = instance['$forms'][_id];
        } else { // binding a form out of context (outside of the main instance)
            $target             = document.getElementById(_id);
            $validator.id           = _id;
            $validator.target       = $target;

            $form = this.$forms[_id] = instance.$forms[_id] = merge({}, $validator);

            var rule    = null;
            if ( typeof(customRule) == 'undefined') {
                rule = _id.replace(/\-/g, '.');

                if ( typeof(rules) != 'undefined' ) {
                    $form['rule'] = customRule = getRuleObjByName(rule)
                } else if ( typeof($form.target) != 'undefined' && $form.target !== null && $form.target.getAttribute('data-gina-form-rule') ) {
                    rule = $form.target.getAttribute('data-gina-form-rule').replace(/\-|\//g, '.');

                    if ( typeof(rules) != 'undefined' ) {
                        $form['rule'] = getRuleObjByName(rule)
                    } else {
                        throw new Error('[ FormValidator::validateFormById(formId) ] using `data-gina-form-rule` on form `'+$form.target+'`: no matching rule found')
                    }
                } // no else to allow form without any rule
            } else {
                rule = customRule.replace(/\-|\//g, '.');

                if ( typeof(rules) != 'undefined' ) {
                    $form['rule'] = getRuleObjByName(rule)
                } else {
                    throw new Error('[ FormValidator::validateFormById(formId, customRule) ] `'+customRule+'` is not a valid rule')
                }
            }

            if ( $target && typeof(this.isPopinContext) != 'undefined' && /true/i.test(this.isPopinContext) ) {
                $target.isPopinContext = this.isPopinContext;
            }

            if ($target && !$form.binded)
                bindForm($target, rule);
        }



        if (!$form) throw new Error('[ FormValidator::validateFormById(formId, customRule) ] `'+_id+'` not found');

        return $form || null;

    }

    var refreshWarning = function($el) {
        var formId = $el.form.getAttribute('id');
        if ( /^true$/i.test(instance.$forms[formId].isValidating) ) {
            return;
        }

        var $parent = $el.parentNode, isErrorMessageHidden = false;
        var $children = $parent.getElementsByTagName('div');

        if ( /form\-item\-warning/.test($parent.className) ) {
            $parent.className = $parent.className.replace(/form\-item\-warning/, 'form-item-error');

        } else if (/form\-item\-error/.test($parent.className) ) {
            $parent.className = $parent.className.replace(/form\-item\-error/, 'form-item-warning');
            isErrorMessageHidden = true;
        }


        for (var c = 0, cLen = $children.length; c<cLen; ++c) {
            if ( /form\-item\-error\-message/.test($children[c].className) ) {
                if (isErrorMessageHidden) {
                    // hide error messages
                    $children[c].className = $children[c].className +' hidden';
                } else {
                    // display error messages
                    $children[c].className = $children[c].className.replace(/(\s+hidden|hidden)/, '');
                }
                break
            }
        }
    }

    /**
     * handleErrorsDisplay
     * Attention: if you are going to handle errors display by hand, set data to `null` to prevent Toolbar refresh with empty data
     * @param {object} $form - Target (HTMLFormElement)
     * @param {object} errors
     * @param {object|null} data
     * @param {object|null} [fileName]
     */
    var liveCheckErrors = {}; // Per Form & Per Element
    var handleErrorsDisplay = function($form, errors, data, fieldName) {

        // Toolbar errors display
        if ( envIsDev )
            var formsErrors = null;

        var errorClass  = 'form-item-error' // by default
            , isWarning = false
        ;
        // catch reset
        if (
            typeof($form.dataset.ginaFormIsResetting) != 'undefined'
            && /^(true)$/i.test($form.dataset.ginaFormIsResetting)
        ) {
            errors = {};
            liveCheckErrors = {};
            // restore default
            $form.dataset.ginaFormIsResetting = false;
        } else {
            // Live check enabled ?
            if (
                /^(true)$/i.test($form.dataset.ginaFormLiveCheckEnabled)
                && typeof(fieldName) != 'undefined'
            ) {
                var formId = ( typeof($form.id) != 'string' ) ? $form.getAttribute('id') : $form.id;
                if ( typeof(liveCheckErrors[formId]) == 'undefined') {
                    liveCheckErrors[formId] = {};
                }
                if (errors.count() > 0) {
                    // reset field name
                    liveCheckErrors[formId][fieldName] = {};
                    // override
                    liveCheckErrors[formId][fieldName] = merge(errors[fieldName], liveCheckErrors[formId][fieldName]);
                    if (liveCheckErrors[formId][fieldName].count() == 0) {
                        delete liveCheckErrors[formId][fieldName]
                    }
                    errors = liveCheckErrors[formId];
                    // only if the form has not been sent yet
                    if (!instance.$forms[formId].sent || instance.$forms[formId].isValidating) {
                        isWarning = true;
                    }
                } else {
                    if ( typeof(liveCheckErrors[formId][fieldName]) != 'undefined') {
                        delete liveCheckErrors[formId][fieldName];
                        if (
                            typeof(window.gina.validator.$forms[formId].errors) != 'undefined'
                            && typeof(window.gina.validator.$forms[formId].errors[fieldName]) != 'undefined'
                        ) {
                            delete window.gina.validator.$forms[formId].errors[fieldName];
                        }
                    }
                    if (
                        typeof(instance.$forms) != 'undefined'
                        && typeof(instance.$forms[formId]) != 'undefined'
                        && typeof(instance.$forms[formId].errors) != 'undefined'
                        && instance.$forms[formId].errors.count() == 0
                    ) {
                        // update submit trigger state
                        updateSubmitTriggerState( $form, true );
                    }

                    if ( typeof(liveCheckErrors[formId]) != 'undefined' && liveCheckErrors[formId].count() == 0 ) {
                        delete liveCheckErrors[formId]
                    } else {
                        errors = liveCheckErrors[formId];
                    }


                }
            }
        }


        var name    = null, errAttr = null;
        var $err    = null, $msg = null;
        var $el     = null, $parent = null, $target = null;
        var id      = $form.getAttribute('id');
        // TODO - Refacto on this may be done later since we are doing nothing with it
        data    = ( typeof(data) != 'undefined' ) ? data : {};

        for (var i = 0, len = $form.length; i<len; ++i) {

            $el     = $form[i];

            if (typeof(fieldName) != 'undefined' && fieldName != $el.name) continue;

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

            if ( typeof(errors[name]) != 'undefined' && !/(form\-item\-error|form\-item\-warning)/.test($parent.className) ) {

                if (isWarning) {
                    // adding warning class
                    $parent.className += ($parent.className == '' ) ? 'form-item-warning' : ' form-item-warning';
                } else {
                    //$parent.className = $parent.className.replace(/(\s+form\-item\-warning|form\-item\-warning)/, '');
                    $parent.className += ($parent.className == '' ) ? 'form-item-error' : ' form-item-error';
                }
                $err = document.createElement('div');
                if (isWarning) {
                    //$err.setAttribute('class', 'form-item-error-message hidden');
                    $err.className = 'form-item-error-message hidden';
                } else {
                    //$err.setAttribute('class', 'form-item-error-message');
                    $err.className = 'form-item-error-message';
                }

                // injecting error messages
                for (var e in errors[name]) {

                    if (e != 'stack') { // ignore stack for display
                        $msg = document.createElement('p');
                        $msg.appendChild( document.createTextNode(errors[name][e]) );
                        $err.appendChild($msg);
                    }

                    if ( envIsDev ) {
                        if (!formsErrors) formsErrors = {};
                        if ( !formsErrors[ name ] )
                            formsErrors[ name ] = {};

                        formsErrors[ name ][e] = errors[name][e]
                    }
                }

                if ($target.type != 'hidden')
                    insertAfter($target, $err);



            } else if ( typeof(errors[name]) == 'undefined' && /(form\-item\-error|form\-item\-warning)/.test($parent.className) || typeof(errors[name]) != 'undefined' && errors[name].count() == 0 && /(form\-item\-error|form\-item\-warning)/.test($parent.className) ) {
                // reset when not in error
                // remove child elements
                var $children = $parent.getElementsByTagName('div');
                for (var c = 0, cLen = $children.length; c<cLen; ++c) {
                    if ( /form\-item\-error\-message/.test($children[c].className) ) {
                        $children[c].parentElement.removeChild($children[c]);
                        break
                    }

                }

                $parent.className = $parent.className.replace(/(\s+form\-item\-error|form\-item\-error|\s+form\-item\-warning|form\-item\-warning)/, '');

            } else if ( typeof(errors[name]) != 'undefined' && errAttr) {
                // refreshing already displayed error on msg update
                var $divs = $parent.getElementsByTagName('div');
                for (var d = 0, dLen = $divs.length; d<dLen; ++d) {
                    if ($divs[d].className == 'form-item-error-message') {

                        $divs[d].parentElement.removeChild($divs[d]);
                        $err = document.createElement('div');
                        $err.setAttribute('class', 'form-item-error-message');

                        // injecting error messages
                        // {
                        //     field: {
                        //         rule: errorMsg
                        //     }
                        // }
                        for (var e in errors[name]) {
                            $msg = document.createElement('p');
                            $msg.appendChild( document.createTextNode(errors[name][e]) );
                            $err.appendChild($msg);

                            if ( envIsDev ) {
                                if (!formsErrors) formsErrors = {};
                                if ( !formsErrors[ name ] )
                                    formsErrors[ name ] = {};

                                formsErrors[ name ][e] = errors[name][e]
                            }
                        }

                        break;
                    }
                }

                if ($err && $target.type != 'hidden')
                    insertAfter($target, $err);

            }

            if (typeof(fieldName) != 'undefined' && fieldName === $el.name) break;
        }


        var objCallback = null;
        if ( formsErrors ) {

            triggerEvent(gina, $form, 'error.' + id, errors)

            if ( envIsDev && isGFFCtx && typeof(window.ginaToolbar) != 'undefined' && window.ginaToolbar ) {
                // update toolbar
                if (!gina.forms.errors)
                    gina.forms.errors = {};

                objCallback = {
                    id      : id,
                    errors  : formsErrors
                };

                window.ginaToolbar.update('forms', objCallback);
            }
        } else if ( envIsDev && isGFFCtx && typeof(window.ginaToolbar) != 'undefined' && window.ginaToolbar) { // reset toolbar form errors
            if (!gina.forms.errors)
                gina.forms.errors = {};

            objCallback = {
                id: id,
                errors: {}
            };
            if (isGFFCtx)
                window.ginaToolbar.update('forms', objCallback);
        }

        if (
            gina
            && isGFFCtx
            && envIsDev
            && instance.$forms[id].isSubmitting
            && /^true$/i.test(instance.$forms[id].isSubmitting)
            && typeof(window.ginaToolbar) != 'undefined'
            && window.ginaToolbar
            && data
        ) {

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
     * @param {object|string} $formOrFormId [$formInstance|$formInstance.target|$formInstance.id]
     *
     * */
    var resetErrorsDisplay = function($formOrFormId) {
        var _id = null, $form = null;
        if ( typeof($formOrFormId) == 'undefined' && typeof(this.id) != 'undefined' ) {
            $formOrFormId = this.id;
        }
        if ( /^string$/i.test(typeof($formOrFormId)) ) {
            _id = $formOrFormId.replace(/\#/, '');
            $form = document.getElementById(_id);
        } else if ( $formOrFormId instanceof HTMLFormElement ) {
            $form = $formOrFormId
        } else if ( /^object$/i.test(typeof($formOrFormId)) ) {
            $form = $formOrFormId.target;
        }

        if (!$form) {
            throw new Error('[ FormValidator::resetErrorsDisplay([ formId | <form> ]) ] `'+$formOrFormId+'` not found')
        }

        // Resetting error display
        $form.dataset.ginaFormIsResetting = true;
        handleErrorsDisplay($form, {});


        return $form
    }

    /**
     * Reset fields
     *
     * @param {object|string} [$form|formId]
     *
     * */
    var resetFields = function($form) {
        var _id = null;
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
                , tagName       = null
                , type          = null
                , value         = null // current value
                , defaultValue  = null
            ;

            for (var f in $form.fieldsSet) {

                $element    = document.getElementById(f);
                type        = $element.tagName.toLowerCase();
                tagName     = $element.tagName;

                if ( /textarea/i.test(tagName) ) {
                    defaultValue = $form.fieldsSet[f].defaultValue;
                    $element.value = defaultValue;
                    triggerEvent(gina, $element, 'change');
                    continue;
                }

                if (type == 'input') {

                    defaultValue = $form.fieldsSet[f].defaultValue;

                    if (/$(on|true|false)$/i.test(defaultValue)) {
                        defaultValue = (/$(on|true)$/i.test(defaultValue)) ? true : false;
                    }

                    if ( /^(checkbox|radio)$/i.test($element.type) ) {
                        $element.checked = $form.fieldsSet[f].defaultChecked;
                    } else if ( !/^(checkbox|radio)$/i.test($element.type) ) {
                        $element.value = defaultValue;
                    }
                    triggerEvent(gina, $element, 'change');

                } else if ( type == 'select' ) {
                    defaultValue = $form.fieldsSet[f].selectedIndex || 0;
                    $element.selectedIndex = defaultValue;
                    $element.dataset.value = $element.options[ $element.selectedIndex ].value;
                    triggerEvent(gina, $element, 'change');
                }

            }
        }

        return $form
    }

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

        if (
            typeof($form.isSending) != 'undefined'
            && /^true$/i.test($form.isSending)
            ||
            typeof($form.sent) != 'undefined'
            && /^true$/i.test($form.sent)
        ) {
            return;
        }
        instance.$forms[id].isSending = true;


        options = (typeof (options) != 'undefined') ? merge(options, xhrOptions) : xhrOptions;
        // `x-gina-form`definition
        //options.headers['X-Gina-Form-Location'] = gina.config.bundle;
        if ( typeof($form.id) != 'undefined' ) {
            options.headers['X-Gina-Form-Id'] = $form.id;
            if (
                typeof(gina.forms.rules) != 'undefined'
                && $form.rules.count() > 0
                && typeof($form.rules[$form.id]) != 'undefined'
            ) {
                options.headers['X-Gina-Form-Rule'] = $form.id +'@'+ gina.config.bundle;
            }
        }
        // if ( typeof($form.name) != 'undefined' ) {
        //     options.headers['X-Gina-Form-Name'] = $form.name;
        // }
        if ( typeof($form.target.dataset.ginaFormRule) != 'undefined' ) {
            options.headers['X-Gina-Form-Rule'] = $form.target.dataset.ginaFormRule +'@'+ gina.config.bundle;
        }


        // forward callback to HTML data event attribute through `hform` status
        hFormIsRequired = ( $target.getAttribute('data-gina-form-event-on-submit-success') || $target.getAttribute('data-gina-form-event-on-submit-error') ) ? true : false;
        // success -> data-gina-form-event-on-submit-success
        // error -> data-gina-form-event-on-submit-error
        if (hFormIsRequired)
            listenToXhrEvents($form);

        var url         = $target.getAttribute('action') || options.url;
        var method      = $target.getAttribute('method') || options.method;
        method          = method.toUpperCase();
        options.method  = method;
        options.url     = url;

        if (!xhr) {
            xhr = setupXhr(options);
        }

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
            //handleXhrResponse(xhr, $target, id, $form, hFormIsRequired);
            xhr.onreadystatechange = function onValidationCallback(event) {
                $form.isSubmitting = false;
                $form.isSending = false;

                // limit send trigger to 1 sec to prevent from double clicks
                setTimeout( function onSent() {
                    $form.sent = false;
                }, 1000);

                // In case the user is also redirecting
                var redirectDelay = (/Google Inc/i.test(navigator.vendor)) ? 50 : 0;

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
                                if ( typeof(gina.popin) != 'undefined' && gina.hasPopinHandler ) {
                                    // select popin current active popin
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
                                            if ( gina && envIsDev && typeof(window.ginaToolbar) && typeof(XHRData) != 'undefined' ) {
                                                window.ginaToolbar.update("data-xhr", XHRData);
                                            }

                                            // update view tab

                                            if ( gina && envIsDev && typeof(window.ginaToolbar) && typeof(XHRView) != 'undefined' ) {
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
                            if ( gina && typeof(window.ginaToolbar) != 'undefined' && window.ginaToolbar && XHRData ) {
                                try {
                                    // don't refresh for html datas
                                    if ( envIsDev && typeof(XHRData) != 'undefined' && /\/html|\/json/.test(contentType) ) {
                                        window.ginaToolbar.update("data-xhr", XHRData);
                                    }

                                } catch (err) {
                                    throw err
                                }
                            }

                            // intercepts upload
                            if ( /^gina\-upload/i.test(id) )
                                onUpload(gina, $target, 'success', id, result);

                            // intercepts result.popin & popin redirect (from SuperController::redirect() )
                            var isXhrRedirect = false;
                            if (
                                typeof(result.isXhrRedirect) != 'undefined'
                                && /^true$/i.test(result.isXhrRedirect)
                            ) {
                                isXhrRedirect = true;
                            }
                            if (
                                typeof(gina.popin) != 'undefined'
                                && gina.hasPopinHandler
                                && typeof(result.popin) != 'undefined'
                                ||
                                typeof(gina.popin) != 'undefined'
                                && gina.hasPopinHandler
                                && typeof(result.location) != 'undefined'
                                && isXhrRedirect
                            ) {
                                var $popin = gina.popin.getActivePopin();
                                if ( !$popin && typeof(result.popin) != 'undefined' ) {
                                    if ( typeof(result.popin) != 'undefined' && typeof(result.popin.name) == 'undefined' ) {
                                        throw new Error('To get a `$popin` instance, you need at list a `popin.name`.');
                                    }
                                    $popin = gina.popin.getPopinByName(result.popin.name);
                                    if ( !$popin ) {
                                        throw new Error('Popin with name: `'+ result.popin.name +'` not found.')
                                    }
                                }

                                if (
                                    typeof(result.popin) != 'undefined'
                                    && typeof(result.popin.close) != 'undefined'
                                ) {
                                    $popin.isRedirecting = false;
                                    $popin.close();
                                    var _reload = (result.popin.reload) ? result.popin.reload : false;
                                    if ( !result.popin.location && !result.popin.url) {
                                       delete result.popin;
                                       // only exception
                                       if (_reload) {
                                        result.popin = { reload: _reload };
                                       }
                                    }
                                }

                                if (
                                    typeof(result.popin) != 'undefined'
                                    && typeof(result.popin.location) != 'undefined'
                                    ||
                                    typeof(result.popin) != 'undefined'
                                    && typeof(result.popin.url) != 'undefined'
                                    ||
                                    typeof(result.location) != 'undefined'
                                    && isXhrRedirect
                                ) {
                                    var popinName = null;
                                    if ( $popin ) {
                                        popinName = $popin.name; // by default
                                        $popin.isRedirecting = true;
                                    }

                                    var _target = '_self'; // by default
                                    if ( typeof(result.popin) != 'undefined' && typeof(result.popin.target) != 'undefined' ) {
                                        if ( /^(blank|self|parent|top)$/ ) {
                                            result.popin.target = '_'+result.popin.target;
                                        }
                                        _target = result.popin.target
                                    }

                                    //var popinUrl = (typeof(result.popin) != 'undefined') ? result.popin.location : result.location;
                                    var popinUrl = result.location || result.popin.location || result.popin.url;
                                    if (
                                        typeof(result.popin) != 'undefined'
                                        && typeof(result.popin.name) != 'undefined'
                                        && popinName != result.popin.name
                                    ) {
                                        //$popin = gina.popin.getActivePopin();
                                        if ($popin)
                                            $popin.close();

                                        popinName = result.popin.name;
                                        $popin = gina.popin.getPopinByName(popinName);
                                        if ( !$popin ) {
                                            throw new Error('Popin with name `'+ popinName+'` not found !');
                                        }
                                        $popin.load($popin.name, popinUrl, $popin.options);
                                    } else if ($popin) {
                                        $popin.load($popin.name, popinUrl, $popin.options);
                                    }
                                    if ($popin) {
                                        return setTimeout( function onPopinredirect($popin){
                                            if (!$popin.isOpen) {
                                                $popin.open();
                                                return;
                                            }
                                        }, 50, $popin);
                                    }
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
                            if ( gina && typeof(window.ginaToolbar) != 'undefined' && window.ginaToolbar && XHRData ) {
                                try {

                                    if ( envIsDev && typeof(XHRData) != 'undefined' ) {
                                        window.ginaToolbar.update("data-xhr", XHRData);
                                    }

                                } catch (err) {
                                    throw err
                                }
                            }

                            // intercept upload
                            if ( /^gina\-upload/i.test(id) )
                                onUpload(gina, $target, 'error', id, result);

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

                            return setTimeout(() => {
                                window.location.href = result.location;
                            }, redirectDelay);
                        }

                    } else if ( xhr.status != 0) {
                        // XHR Error
                        result = { 'status': xhr.status };
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
                                    // forward appplication errors to validator when available
                                    $form.eventData.error = result;

                                    // update toolbar
                                    XHRData = result;
                                    if ( gina && envIsDev && typeof(window.ginaToolbar) != 'undefined' && window.ginaToolbar && XHRData ) {
                                        try {
                                            // update toolbar
                                            window.ginaToolbar.update('data-xhr', XHRData );

                                        } catch (err) {
                                            throw err
                                        }
                                    }

                                    // intercept upload
                                    if ( /^gina\-upload/i.test(id) )
                                        onUpload(gina, $target, 'error', id, result);

                                    triggerEvent(gina, $target, 'error.' + id, result);
                                    if (hFormIsRequired)
                                        triggerEvent(gina, $target, 'error.' + id + '.hform', result);

                                    return;
                                }


                            });

                            // Start reading the blob as text.
                            reader.readAsText(blob);

                        } else { // normal case

                            if ( /^(\{|\[)/.test( xhr.responseText ) ) {

                                try {
                                    result = merge( JSON.parse(xhr.responseText), result )
                                } catch (err) {
                                    result = merge(err, result)
                                }

                            } else if ( typeof(xhr.responseText) == 'object' ) {
                                result = merge(xhr.responseText, result)
                            } else {
                                result.message = xhr.responseText
                            }

                            // xhr error response (caching)
                            //$form.eventData.error = result;
                            // Forward appplication errors to forms.errors when available
                            // This api error is meant for the Frontend Validation Errors Handling
                            if ( typeof(result) != 'undefined' && typeof(result.error) != 'undefined' &&  result.fields && typeof(result.fields) == 'object') {

                                var apiMessage = ( typeof(result.message) != 'undefined') ? result.message : null;
                                var newResultfields = {};
                                for (let f in result.fields) {
                                    let errorObject = {};
                                    errorObject[f] = {};
                                    errorObject[f].isApiError = result.fields[f];
                                    if ( apiMessage && !errorObject[f].isApiError) {
                                        errorObject[f].isApiError = result.error; // Generic error
                                    }
                                    newResultfields[f] = errorObject[f];
                                    handleErrorsDisplay($form.target, errorObject, data, f);

                                }
                                result.fields = newResultfields
                            }
                            $form.eventData.error = result;


                            // update toolbar
                            XHRData = result;
                            if ( gina && envIsDev && typeof(window.ginaToolbar) != 'undefined' && window.ginaToolbar && XHRData ) {
                                try {
                                    // update toolbar
                                    window.ginaToolbar.update('data-xhr', XHRData );

                                } catch (err) {
                                    throw err
                                }
                            }


                            // intercept upload
                            if ( /^gina\-upload/i.test(id) )
                                onUpload(gina, $target, 'error', id, result);

                            triggerEvent(gina, $target, 'error.' + id, result);
                            if (hFormIsRequired)
                                triggerEvent(gina, $target, 'error.' + id + '.hform', result);



                        }


                    } /**else if ( xhr.readyState == 4 && xhr.status == 0 ) { // unknown error
                        // Consider also the request timeout
                        // Modern browser return readyState=4 and status=0 if too much time passes before the server response.
                        result = { 'status': 408, 'message': 'XMLHttpRequest Exception: unkown error' };
                        XHRData = result;
                        // update toolbar
                        if ( gina && typeof(window.ginaToolbar) != 'undefined' && window.ginaToolbar && XHRData ) {
                            try {
                                // don't refresh for html datas
                                if ( envIsDev && typeof(XHRData) != 'undefined' && /\/html/.test(contentType) ) {
                                    window.ginaToolbar.update("data-xhr", XHRData);
                                }

                            } catch (err) {
                                throw err
                            }
                        }

                        // intercept upload
                        if ( /^gina\-upload/i.test(id) ) {
                            result.message = 'XMLHttpRequest Exception: trying to render an unknwon file.'
                            onUpload(gina, $target, 'error', id, result);
                        }
                        triggerEvent(gina, $target, 'error.' + id, result);

                        if (hFormIsRequired)
                            triggerEvent(gina, $target, 'error.' + id + '.hform', result);

                        return;
                    }*/
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

                //console.debug('xhr progress ', percentComplete);

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

                // intercept upload
                if ( /^gina\-upload/i.test(id) )
                    onUpload(gina, $target, 'error', id, result);

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
                        , b         = 0
                        , newData   = {};

                    try {
                        if ( !(data instanceof FormData) ) {
                            data = JSON.stringify(data)
                        } else {
                            var uploadGroup   = event.currentTarget.getAttribute('data-gina-form-upload-group') || 'untagged';
                            for (var [key, value] of data.entries()) {
                                // file upload case
                                if (value instanceof File) {
                                    if (!hasBinaries)
                                        hasBinaries = true;

                                    binaries[b] = {
                                        key: key,
                                        group: uploadGroup, // `untagged` by default
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
                                    //throw err
                                    // intercept upload
                                    if ( /^gina\-upload/i.test(id) )
                                        onUpload(gina, $target, 'error', id, err);

                                    triggerEvent(gina, $target, 'error.' + id, err);

                                    if (hFormIsRequired)
                                        triggerEvent(gina, $target, 'error.' + id + '.hform', err);
                                } else {

                                    if (done) {
                                        xhr.setRequestHeader('Content-Type', 'multipart/form-data; boundary=' + boundary);
                                        xhr.send(data);

                                        $form.sent = true;
                                        if ( envIsDev && isGFFCtx && typeof(window.ginaToolbar) != 'undefined' && window.ginaToolbar ) {
                                            // update toolbar
                                            if (!gina.forms.sent)
                                                gina.forms.sent = {};

                                            var objCallback = {
                                                id      : id,
                                                sent    : data
                                                //sent    : ( typeof(data) == 'string' ) ? JSON.parse(data) : data
                                            };

                                            window.ginaToolbar.update('forms', objCallback);
                                        }
                                    }

                                    done = false;

                                    return false;
                                }
                            });

                        } else if ( typeof(newData) != 'undefined' && newData.count() > 0 ) { // without file
                            data = JSON.stringify(newData)
                        }


                    } catch (err) {
                        // intercept upload
                        if ( /^gina\-upload/i.test(id) )
                            onUpload(gina, $target, 'error', id, err);

                        triggerEvent(gina, $target, 'error.' + id, err);

                        if (hFormIsRequired)
                            triggerEvent(gina, $target, 'error.' + id + '.hform', err);
                    }
                }
                //console.debug('sending -> ', data);
                if (!hasBinaries) {
                    if (typeof (enctype) != 'undefined' && enctype != null && enctype != '') {
                        xhr.setRequestHeader('Content-Type', enctype);
                    }
                    xhr.send(data)
                }

            } else {

                if ( typeof(enctype) != 'undefined' && enctype != null && enctype != ''){
                    xhr.setRequestHeader('Content-Type', enctype);
                }
                xhr.send()
            }

            $form.sent = true;
            if ( envIsDev && isGFFCtx && typeof(window.ginaToolbar) != 'undefined' && window.ginaToolbar ) {
                // update toolbar
                if (!gina.forms.sent)
                    gina.forms.sent = {};

                var objCallback = {
                    id      : id,
                    sent    : ( typeof(data) == 'string' ) ? JSON.parse(data) : data
                };

                window.ginaToolbar.update('forms', objCallback);
            }
        }
    }

    var onUpload = function(gina, $target, status, id, data) {

        var uploadProperties = $target.uploadProperties || null;
        // FYI
        // {
        //     id              : String,
        //     $form           : $Object,
        //     mandatoryFields : Array,
        //     uploadFields    : ObjectList
        //     hasPreviewContainer : Boolean,
        //     previewContainer : $Object
        // }

        if ( !uploadProperties )
            throw new Error('No uploadProperties found !!');
        // parent form
        // var $mainForm = uploadProperties.$form;
        var $uploadTriger = document.getElementById(uploadProperties.uploadTriggerId);
        var searchArr   = null
            , name      = null
            , $previewContainer     = null
            , files                 = data.files || []
            , $error                = null
        ;
        // reset previewContainer
        if ( uploadProperties.hasPreviewContainer ) {
            $previewContainer = document.getElementById(uploadProperties.previewContainer.id);
            if ($previewContainer)
                $previewContainer.innerHTML = '';
        }

        if (uploadProperties.errorField) {
            $error = document.getElementById(uploadProperties.errorField)
        }


        //reset errors
        if ($error)
            $error.style.display = 'none';

        if ($error && status != 'success') { // handle errors first
           // console.error('[ mainUploadError ] ', status, data)
            var errMsg = data.message || data.error;

            $error.innerHTML = '<p>'+ errMsg +'</p>';
            fadeIn($error);
        } else if(!$error && status != 'success') {
            throw new Error(errMsg)
        } else {

            var fieldsObjectList = null
                , $li   = null
                , maxWidth = null
                , ratio = null
            ;
            for (var f = 0, fLen = files.length; f<fLen; ++f) {

                // creating reset link
                let resetLinkId = $previewContainer.id.replace(/\-preview/, '-'+f+'-reset-trigger');
                let resetLinkNeedToBeAdded = false;
                let $resetLink = document.getElementById(resetLinkId);
                let defaultClassNameArr = ['reset','js-upload-reset'];
                if (!$resetLink) {
                    resetLinkNeedToBeAdded      = true;
                    $resetLink                  = document.createElement('A');
                    $resetLink.href             = '#';
                    $resetLink.innerHTML        = $uploadTriger.getAttribute('data-gina-form-upload-reset-label') || 'Reset';
                    $resetLink.className        = defaultClassNameArr.join(' ');
                    $resetLink.id               = resetLinkId;
                } else {
                    if ( /a/i.test($resetLink.tagName) ) {
                        $resetLink.href             = '#';
                    }
                    if ( !$resetLink.innerHTML || $resetLink.innerHTML == '' ) {
                        $resetLink.innerHTML        = $uploadTriger.getAttribute('data-gina-form-upload-reset-label') || 'Reset';
                    }
                    if ( typeof($resetLink.className) == 'undefined' ) {
                        $resetLink.className = "";
                    }
                    let classNameArr = merge($resetLink.className.split(/\s+/g), defaultClassNameArr);
                    $resetLink.className    = classNameArr.join(' ');
                }
                $resetLink.style.display    = 'none';

                // image preview
                if ( typeof(files[f].preview) == 'undefined'
                    && uploadProperties.hasPreviewContainer
                    && /^image/.test(files[f].mime)
                    && files[f].location != ''
                ) {
                    let $img    = document.createElement('IMG');
                    $img.src    = files[f].tmpUri;
                    $img.style.display = 'none';
                    $img.setAttribute('data-upload-original-filename', files[f].originalFilename);
                    $img.setAttribute('data-upload-reset-link-id', $resetLink.id);

                    // TODO - Remove this; we don't want it by default, the dev can force it by hand if needed
                    // if (files[f].width) {
                    //     $img.width  = files[f].width;
                    // }
                    // if (files[f].height) {
                    //     $img.height = files[f].height;
                    // }

                    maxWidth = $previewContainer.getAttribute('data-preview-max-width') || null;
                    if ( $img.width && maxWidth && $img.width > maxWidth ) {
                        ratio = $img.width / maxWidth;
                        $img.width = maxWidth;
                        $img.height = $img.height / ratio;
                    } else if (!$img.width && maxWidth ) {
                        $img.width = maxWidth
                    }

                    if ( /ul/i.test(uploadProperties.previewContainer.tagName) ) {
                        $li = document.createElement('LI');
                        $li.className = 'item';
                        $li.appendChild($img);
                        $previewContainer.appendChild($li);
                    } else {
                        $previewContainer.appendChild($img);
                    }
                    fadeIn($img);
                }
                // fill the fields to be saved ;)
                fieldsObjectList = uploadProperties.uploadFields[f];
                var $elIgnored = null;
                for (var key in fieldsObjectList) {
                    // update field value
                    if (
                        key == 'name' && fieldsObjectList[key].value != ''
                        || !files[f][key]
                        || key == 'preview' && typeof(files[f][key]) == 'undefined'
                        || /(height|width)/i.test(key) && !/^image/.test(files[f].mime)
                    ) {
                        if ( /(preview|height|width)/i.test(key) ) {
                            $elIgnored = document.getElementById(fieldsObjectList[key].id);
                            if ( $elIgnored )
                                $elIgnored.parentNode.removeChild($elIgnored);
                        }
                        continue;
                    }
                    //fieldsObjectList[key].value = (/object/i.test(typeof(files[f][key])) ) ? JSON.stringify( files[f][key] ) : files[f][key];
                    fieldsObjectList[key].value = files[f][key];
                    // update submited $fields ??

                    // handle preview
                    if ( key == 'preview' ) {

                        for (var previewKey in files[f][key]) {
                            if ( typeof(files[f][key][previewKey]) != 'undefined' && typeof(fieldsObjectList[key][previewKey]) != 'undefined' ) {
                                fieldsObjectList[key][previewKey].value = files[f][key][previewKey];
                            }

                            // with preview
                            if ( previewKey == 'tmpUri' && uploadProperties.hasPreviewContainer ) {

                                // // creating reset link
                                // let resetLinkId = $previewContainer.id.replace(/\-preview/, '-'+f+'-reset-trigger');
                                // let resetLinkNeedToBeAdded = false;
                                // let $resetLink = document.getElementById(resetLinkId);
                                // let defaultClassNameArr = ['reset','js-upload-reset'];
                                // if (!$resetLink) {
                                //     resetLinkNeedToBeAdded      = true;
                                //     $resetLink                  = document.createElement('A');
                                //     $resetLink.href             = '#';
                                //     $resetLink.innerHTML        = $uploadTriger.getAttribute('data-gina-form-upload-reset-label') || 'Reset';
                                //     $resetLink.className        = defaultClassNameArr.join(' ');
                                //     $resetLink.id               = resetLinkId;
                                // } else {
                                //     if ( /a/i.test($resetLink.tagName) ) {
                                //         $resetLink.href             = '#';
                                //     }
                                //     if ( !$resetLink.innerHTML || $resetLink.innerHTML == '' ) {
                                //         $resetLink.innerHTML        = $uploadTriger.getAttribute('data-gina-form-upload-reset-label') || 'Reset';
                                //     }
                                //     if ( typeof($resetLink.className) == 'undefined' ) {
                                //         $resetLink.className = "";
                                //     }
                                //     let classNameArr = merge($resetLink.className.split(/\s+/g), defaultClassNameArr);
                                //     $resetLink.className    = classNameArr.join(' ');
                                // }
                                // $resetLink.style.display    = 'none';


                                // creating IMG tag
                                let $img = document.createElement('IMG');
                                $img.src = files[f][key].tmpUri;
                                $img.style.display = 'none';
                                // retrieve img `originalFilename` (not the preview img[key] `originalFilename`)
                                // these 2 metadatas will be used to remove files from the server
                                $img.setAttribute('data-upload-original-filename', files[f].originalFilename);
                                $img.setAttribute('data-upload-preview-original-filename', files[f][key].originalFilename);
                                // in order to retrieve and remove reset link
                                $img.setAttribute('data-upload-reset-link-id', $resetLink.id);

                                maxWidth = $previewContainer.getAttribute('data-preview-max-width') || null;
                                if ( maxWidth ) {
                                    $img.width = maxWidth
                                }

                                if ( /ul/i.test(uploadProperties.previewContainer.tagName) ) {
                                    $li = document.createElement('LI');
                                    $li.className = 'item';
                                    $li.appendChild($img);
                                    // if (resetLinkNeedToBeAdded)
                                    //     $li.appendChild($resetLink);

                                    $previewContainer.appendChild($li);
                                } else {
                                    $previewContainer.appendChild($img);
                                    // if (resetLinkNeedToBeAdded)
                                    //     $previewContainer.appendChild($resetLink);
                                }
                                fadeIn($img);
                                // // bind reset trigger
                                // bindUploadResetOrDeleteTrigger('reset', $uploadTriger, f);
                                // fadeIn($resetLink);
                            }
                        }
                    }
                } // EO for

                if (uploadProperties.hasPreviewContainer) {
                    if ( /ul/i.test(uploadProperties.previewContainer.tagName) ) {
                        $li = document.createElement('LI');
                        $li.className = 'item';
                        if (resetLinkNeedToBeAdded)
                            $li.appendChild($resetLink);
                        $previewContainer.appendChild($li);
                    } else {
                        if (resetLinkNeedToBeAdded)
                            $previewContainer.appendChild($resetLink);
                    }
                }
                // bind reset trigger
                bindUploadResetOrDeleteTrigger('reset', $uploadTriger, f);
                fadeIn($resetLink);
            } // EO for f
        }
    }

    /**
     * onUploadResetOrDelete
     *
     * @param {object} $uploadTrigger
     * @param {string} bindingType - `reset` or `delete`
     * @returns
     */
    var onUploadResetOrDelete = function($uploadTrigger, bindingType) {
        console.debug(bindingType + ' input files');
        var isOnResetMode       = ( /reset/i.test(bindingType) ) ? true : false
            , uploadPreviewId   = $uploadTrigger.id +'-preview'
            , $uploadPreview    = document.getElementById(uploadPreviewId);

        var childNodeFile           = null
            , childNodeFilePreview  = null
            , childNodes            = $uploadPreview.childNodes
            , $resetLink            = null
            , files                 = $uploadTrigger.customFiles
            , filesToBeRemoved      = []
        ;

        for (let i = 0, len = childNodes.length; i < len; i++) {
            // only look for IMG tags
            if ( /img/i.test(childNodes[i].tagName) ) {
                if (isOnResetMode) {
                    childNodeFile           =  childNodes[i].getAttribute('data-upload-original-filename');
                    filesToBeRemoved.push(childNodeFile);
                    childNodeFilePreview    = childNodes[i].getAttribute('data-upload-preview-original-filename');
                    if (childNodeFilePreview) {
                        filesToBeRemoved.push(childNodeFilePreview);
                    }
                } else {
                    let file = childNodes[i].src.substr(childNodes[i].src.lastIndexOf('/')+1);
                    childNodeFile = file;
                    filesToBeRemoved.push(childNodeFile);
                }

                // remove file from input.files
                for (let f = 0, fLen = files.length; f < fLen; f++) {
                    if (files[f].name == childNodeFile) {
                        // get resetLink element
                        if (isOnResetMode) {
                            $resetLink      = document.getElementById( childNodes[i].getAttribute('data-upload-'+ bindingType +'-link-id') );
                        } else {
                            $resetLink      = document.getElementById( files[f].deleteLinkId );
                        }

                        // hide reset or delete link & image
                        $resetLink.style.display = 'none';
                        childNodes[i].style.display = 'none';

                        // remove file from input.files
                        files.splice(f, 1);
                        // Since `$uploadTrigger.files` isFrozen & isSealed
                        $uploadTrigger.customFiles  = files;
                        if (isOnResetMode) {
                            $uploadTrigger.value        = files.join(', C:\\fakepath\\');
                        }

                        // update form files for validation & submit/send
                        let re = new RegExp('^'+($uploadTrigger.name+'['+f+']').replace(/\-|\[|\]|\./g, '\\$&'));
                        for ( let d = 0, dLen = $uploadTrigger.form.length; d < dLen; d++) {
                            // data-gina-form-upload-is-locked
                            // this exception prevent `tagged datas` to be deleted on image delete
                            let isLocked = $uploadTrigger.form[d].dataset.ginaFormUploadIsLocked || false;
                            if ( re.test($uploadTrigger.form[d].name) && !/true/i.test(isLocked) ) {
                                $uploadTrigger.form[d].remove();
                                dLen--;
                                d--;
                                //update toolbar
                                if (gina && envIsDev && isGFFCtx && typeof(window.ginaToolbar) != 'undefined' && window.ginaToolbar ) {
                                    try {
                                        // update toolbar
                                        window.ginaToolbar.update('data-xhr', {files: files});
                                    } catch (err) {
                                        throw err
                                    }
                                }
                            }
                        }
                        // remove file from the server - filesToBeRemoved
                        let url = $uploadTrigger.getAttribute('data-gina-form-upload-'+ bindingType +'-action');
                        if ( !url || typeof(url) == 'undefined' || url == '' || /404/.test(url) ) {
                            throw new Error('input file `'+ $uploadTrigger.id +'` error: `data-gina-form-upload-'+bindingType+'-action` is required. You need to provide a valide url.');
                        }
                        let method = $uploadTrigger.getAttribute('data-gina-form-upload-'+ bindingType +'-method');
                        if ( !method || typeof(method) == 'undefined' || method == '') {
                            if (isOnResetMode) {
                                method = 'POST';
                            } else {
                                method = (filesToBeRemoved.length > 1) ? 'POST': 'DELETE';
                                console.warn('`data-gina-form-upload-'+ bindingType +'-method` was not defined. Switching to `'+ method +'` by default.');
                            }
                        } else {
                            method = method.toUpperCase();
                        }
                        let isSynchrone = $uploadTrigger.getAttribute('data-gina-form-upload-'+ bindingType +'-is-synchrone');
                        if ( /null/i.test(isSynchrone) || typeof(method) == 'undefined' || method == '' ) {
                            isSynchrone = true;
                        }

                        let xhrOptions = {
                            url: url,
                            method: method,
                            isSynchrone: isSynchrone,
                            headers : {
                                // to upload, use `multipart/form-data` for `enctype`
                                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                                // cross domain is enabled by default, but you need to setup `Access-Control-Allow-Origin`
                                'X-Requested-With': 'XMLHttpRequest' // in case of cross domain origin
                            }
                        };
                        let xhr = setupXhr(xhrOptions);
                        //handleXhr(xhr);
                        if ( /GET|DELETE/i.test(method) ) {
                            xhr.send();
                        } else {
                            xhr.send(JSON.stringify({ files: filesToBeRemoved }));
                        }

                        // when there is no more files to preview, restore input file visibility
                        // display upload input
                        if ( /none/i.test(window.getComputedStyle($uploadTrigger).display) ) {
                            // eg.: visibility could be delegated to a parent element such as label or a div
                            if ( /none/i.test($uploadTrigger.parentElement.style.display) ) {
                                $uploadTrigger.parentElement.style.display = 'block';
                                return;
                            }
                            $uploadTrigger.style.display = 'block';
                        }

                        // remove reset link event
                        removeListener(gina, $uploadResetTrigger, 'click', function onUploadResetTriggerEventRemoved() {
                            // remove link & image - must be done last
                            $resetLink.remove();
                            childNodes[i].remove();
                        });
                        len--;
                        i--;
                        break;
                    }
                } // EO for
            }
        }
    }

    /**
     * Convert <Uint8Array|Uint16Array|Uint32Array> to <String>
     * @param {array} buffer
     * @param {number} [byteLength] e.g.: 8, 16 or 32
     *
     * @returns {string} stringBufffer
     */
    var ab2str = function(event, buf, byteLength) {

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
        var offset = 0, len = null, subab = null;

        for (; offset < abLen; offset += CHUNK_SIZE) {
            len = Math.min(CHUNK_SIZE, abLen - offset);
            subab = ab.subarray(offset, offset + len);
            str += String.fromCharCode.apply(null, subab);
        }

        return str;
    }


    var processFiles = function(binaries, boundary, data, f, onComplete) {

        var reader = new FileReader();

        // progress
        // reader.addEventListener('progress', (e) => {
        //     var percentComplete = '0';
        //     if (e.lengthComputable) {
        //         percentComplete = e.loaded / e.total;
        //         percentComplete = parseInt(percentComplete * 100);

        //     }

        //     // var result = {
        //     //     'status': 100,
        //     //     'progress': percentComplete
        //     // };

        //     console.debug('progress', percentComplete);

        //     //$form.eventData.onprogress = result;

        //     //triggerEvent(gina, $target, 'progress.' + id, result)
        // });

        reader.addEventListener('load', function onReaderLoaded(e) {

            e.preventDefault();

            // var percentComplete = '0';
            // if (e.lengthComputable) {
            //     percentComplete = e.loaded / e.total;
            //     percentComplete = parseInt(percentComplete * 100);

            //     console.debug('progress', percentComplete);
            // }


            try {

                var bin = ab2str(e, this.result);
                ;
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
                // Define the upload group
                + 'group="' + binaries[this.index].group + '"; '
                // Provide the real name of the file
                + 'filename="' + binaries[this.index].file.name + '"\r\n'
                // And the MIME type of the file
                + 'Content-Type: ' + binaries[this.index].file.type + '\r\n'
                // File length
                + 'Content-Length: ' + binaries[this.index].bin.length + '\r\n'
                // There's a blank line between the metadata and the data
                + '\r\n';

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

            addListener(gina, $form.target, 'destroy.' + _id, function(event) {

                cancelEvent(event);

                delete instance['$forms'][_id];
                removeListener(gina, event.currentTarget, event.type);
                removeListener(gina, event.currentTarget,'destroy');
            });

            // remove existing listeners
            $form = unbindForm($form);

            //triggerEvent(gina, instance['$forms'][_id].target, 'destroy.' + _id);
            triggerEvent(gina, $form.target, 'destroy.' + _id);

        } else {
            throw new Error('[ FormValidator::destroy(formId) ] `'+_id+'` not found');
        }

    }

    /**
     * cleanupInstanceRules
     * Will remove _case_ condition for empty rules
     * Used to remove empty `@import` after `checkForRulesImports` is called
     *
     */
    var cleanupInstanceRules = function() {
        var rule = ( typeof(arguments[0]) != 'undefined' ) ? arguments[0] : instance.rules;
        for (let r in rule) {
            let props = Object.getOwnPropertyNames(rule[r]);
            let p = 0, pLen = props.length;
            let hasCases = false, caseName = null;
            while (p < pLen) {
                if ( /^\_case\_/.test(props[p]) ) {
                    hasCases = true;
                    caseName = props[p];
                    break;
                }
                p++
            }

            if ( !hasCases && typeof(rule[r]) == 'object') {
                cleanupInstanceRules(rule[r]);
            }

            if (caseName && Array.isArray(rule[r][caseName].conditions) && rule[r][caseName].conditions.length > 0) {
                let c = 0, len = rule[r][caseName].conditions.length;
                while (c < len) {
                    if (
                        typeof(rule[r][caseName].conditions[c].rules) != 'undefined'
                        && rule[r][caseName].conditions[c].rules.count() == 0
                    ) {
                        rule[r][caseName].conditions.splice(c, 1);
                        len--;
                        c--;
                    }
                    c++;
                }
            }
        }
    }

    var checkForRulesImports = function (rules) {
        // check if rules has imports & replace
        var rulesStr        = JSON.stringify(rules);
        var importedRules   = rulesStr.match(/(\"@import\s+[-_a-z A-Z 0-9/.]+\")/g) || [];
        // remove duplicate
        var filtered = [];
        for (let d = 0, dLen = importedRules.length; d < dLen; d++) {
            if (filtered.indexOf(importedRules[d]) < 0) {
                filtered.push(importedRules[d])
            }
        }
        importedRules = filtered;
        // TODO - complete mergingRules integration
        var mergingRules     = rulesStr.match(/(\"_merging(.*))(\s+\:|\:)(.*)(\",|\")/g)
        var isMerging       = false;
        if (!instance.rules) {
            instance.rules = {}
        }
        if (importedRules && importedRules.length > 0) {
            var ruleArr = [], rule = {}, tmpRule = null, re = null;
            for (let r = 0, len = importedRules.length; r<len; ++r) {
                let importPath = importedRules[r].replace(/(@import\s+|\"|\')/g, '');
                ruleArr = importPath.replace(/(@import\s+|\"|\')/g, '').split(/\s/g);
                // [""@import client/form", ""@import project26/edit demo/edit"]
                //console.debug('ruleArr -> ', ruleArr, importedRules[r]);
                for (let i = 0, iLen = ruleArr.length; i<iLen; ++i) {
                    tmpRule = ruleArr[i].replace(/\//g, '.').replace(/\-/g, '.');
                    if ( typeof(instance.rules[ tmpRule ]) != 'undefined' ) {
                        let rule = JSON.stringify(instance.rules[ tmpRule ]);
                        let strRule = JSON.parse(rule);
                        if ( typeof(strRule['_comment']) != 'undefined' ) {
                            strRule['_comment'] += '\n';
                        } else {
                            strRule['_comment'] = '';
                        }
                        strRule['_comment'] += 'Imported from `'+ importPath +'`';
                        rule = JSON.stringify(strRule);
                        rulesStr = rulesStr.replace(new RegExp(importedRules[r], 'g'), rule);
                        // also need to replace in instance.rules
                        instance.rules = JSON.parse(JSON.stringify(instance.rules).replace(new RegExp(importedRules[r], 'g'), '{}'));
                    } else {
                        console.warn('[formValidator:rules] <@import error> on `'+importedRules[r]+'`: rule `'+ruleArr[i]+'` not found. Ignoring.');
                        continue;
                    }
                }
                //console.debug('replacing ', importedRules[r]);
                re = new RegExp(importedRules[r]);
                isMerging = ( mergingRules && re.test(mergingRules.join()) ) ? true : false;
                if( isMerging ) {

                    for (let m = 0, mLen = mergingRules.length; m < mLen; m++) {
                        if ( re.test(mergingRules[m]) ) {
                            let tmpStr = JSON.stringify(rule);
                            tmpStr = tmpStr.substr(1, tmpStr.length-1);// removing ->{ ... }<-
                            // is last ?
                            if (m < mLen-1) {
                                tmpStr += ','
                            }
                            try {
                                rulesStr = rulesStr.replace( new RegExp(mergingRules[m], 'g'), tmpStr);
                                // also need to replace in instance.rules
                                instance.rules = JSON.parse(JSON.stringify(instance.rules).replace(new RegExp(mergingRules[m], 'g'), '{}'));
                            } catch (error) {
                                throw error
                            }
                        }
                    }

                }
                rule = {}
            }

            rules = JSON.parse(rulesStr);
            parseRules(rules, '');

            try {
                cleanupInstanceRules();
            } catch (err) {
                console.error(err.stack);
            }
        }

        return rules;
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
            instance.on('init', function onValidatorInit(event) {
                // parsing rules
                if ( typeof(rules) != 'undefined' && rules.count() ) {
                    try {
                        parseRules(rules, '');
                        rules = checkForRulesImports(rules);
                        // making copy
                        if ( typeof(gina.forms.rules) == 'undefined' || !gina.forms.rules) {
                            gina.forms.rules = rules
                        } else { // inherits
                            gina.forms.rules = merge(gina.forms.rules, rules, true);
                        }
                        // update instance.rules
                        instance.rules = merge(instance.rules, JSON.clone(gina.forms.rules), true);
                    } catch (err) {
                        throw (err)
                    }
                }

                if ( !local.rules.count() ) {
                    local.rules = JSON.clone(instance.rules);
                }


                $validator.setOptions           = setOptions;
                $validator.getFormById          = getFormById;
                $validator.validateFormById     = validateFormById;
                $validator.resetErrorsDisplay   = resetErrorsDisplay;
                $validator.resetFields          = resetFields;
                $validator.handleErrorsDisplay  = handleErrorsDisplay;
                $validator.submit               = submit;
                $validator.send                 = send;
                $validator.unbind               = unbindForm;
                $validator.bind                 = bindForm;
                $validator.reBind               = reBindForm;
                $validator.destroy              = destroy;

                var id          = null
                    , $target   = null
                    , i         = 0
                    , $forms    = []
                    , $allForms = document.getElementsByTagName('form');


                // form has rule ?
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

                    //$allForms[f]['id'] = $validator.id = id;
                    $validator.id = id;

                    //if ( typeof($allForms[f].getAttribute('id')) != 'undefined' && $allForms[f].id != 'null' && $allForms[f].id != '') {

                        $validator.target = $allForms[f];
                        instance.$forms[id] = merge({}, $validator);

                        var customRule = $allForms[f].getAttribute('data-gina-form-rule');

                        if (customRule) {
                            customRule = customRule.replace(/\-|\//g, '.');
                            if ( typeof(rules) != 'undefined' ) {
                                instance.$forms[id].rules[customRule] = instance.rules[customRule] = local.rules[customRule] = merge(JSON.clone( eval('gina.forms.rules.'+ customRule)), instance.rules[customRule]);
                            }
                            if ( typeof(local.rules[customRule]) == 'undefined' ) {
                                throw new Error('['+id+'] no rule found with key: `'+customRule+'`. Please check if json is not malformed @ /forms/rules/' + customRule.replace(/\./g, '/') +'.json');
                            }
                            customRule = instance.rules[customRule];
                        }

                        // finding forms handled by rules
                        if (
                            typeof(id) == 'string'
                            && typeof(local.rules[id.replace(/\-/g, '.')]) != 'undefined'
                            ||
                            typeof(customRule) == 'object'
                        ) {
                            $target = instance.$forms[id].target;
                            if (customRule) {
                                bindForm($target, customRule)
                            } else {
                                bindForm($target)
                            }

                            ++i
                        }
                        // TODO - remove this
                        // migth not be needed anymore
                        else {
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
                    //}

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

        var customRule = null
            , rules = ( typeof(local.rules.count() > 0 ) ) ? local.rules : instance.rules
        ;

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
                customRule = customRule.replace(/\-|\//g, '.');
                if ( typeof(rules[customRule]) == 'undefined') {
                    customRule = null;
                    throw new Error('[' + $form.id + '] no rule found with key: `' + customRule + '`');
                } else {
                    customRule = rules[customRule]
                }
            }

            // finding forms handled by rules
            if (typeof ($form.id) == 'string' && typeof (rules[$form.id.replace(/\-/g, '.')]) != 'undefined') {
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

    var getRuleObjByName = function(ruleName) {

        if ( typeof(local.rules[ruleName]) != 'undefined' ) {
            return local.rules[ruleName]
        }
        var rules = null;
        // just in case : many ways to access this method
        if ( typeof(instance.rules[ruleName]) == 'undefined' ) {
            parseRules(local.rules, '');
            local.rules = checkForRulesImports(local.rules);
            rules = local.rules[ruleName];
            if ( !rules ) {
                return {}
            }
        } else {
            rules = instance.rules[ruleName]
        }

        var ruleObj = JSON.clone(rules)
            , re = new RegExp('^'+ruleName)
            , propRe = new RegExp('^'+ruleName +'.')
            , propName = null
        ;

        var rulesFromPath = function(obj, keys, val, originalRuleObj, field, i, len) {
            if (!keys.length) {
                return
            }

            var _id = Object.getOwnPropertyNames(obj)[0];
            var _key = keys[0];
            var nextFieldName = null;
            if ( field == '') {
                field += _key;
                nextFieldName = field
            } else {
                nextFieldName =  field + '['+ _key + ']'
            }

            if ( keys.length == 1) {
                // obj[ _key ] =  (
                //     typeof(obj[ _key ]) == 'undefined'
                //     && typeof(val) == 'object'
                //     && Array.isArray(val)
                // ) ? [] : {} ;

                obj[ _id ] = merge(obj[ _id ], val, true);

                // if (
                //     typeof(originalRuleObj[nextFieldName]) != 'undefined'
                //     //&& typeof(originalRuleObj[nextFieldName][_key]) != 'undefined'
                // ) {

                //     originalRuleObj[nextFieldName] = val//merge(originalRuleObj[nextFieldName], val, true);
                //     //if ( typeof(originalRuleObj[nextFieldName][_key]) != 'undefined' ) {
                //     //    originalRuleObj[nextFieldName][_key] = val
                //     //}// else {
                //       //  originalRuleObj[nextFieldName][_key] = merge(originalRuleObj[nextFieldName][_key], val, true);
                //     //}


                // } else if (
                //     typeof(originalRuleObj[field]) != 'undefined'
                //     //&& typeof(originalRuleObj[field][_key]) != 'undefined'
                // ) {
                //     originalRuleObj[field] = val
                //     //originalRuleObj[field] = merge(originalRuleObj[field], val, true);
                //     //if ( typeof(originalRuleObj[field][_key]) != 'undefined' ) {
                //     //    originalRuleObj[field][_key] = val//merge(originalRuleObj[field][_key], val, true);
                //     //} //else {
                //      //   originalRuleObj[field] = merge(originalRuleObj[field], val, true);
                //     //}

                // }  else if ( typeof(originalRuleObj[_key]) != 'undefined' ) {
                //     originalRuleObj[_key] = val
                //    //originalRuleObj[_key] = merge(originalRuleObj[_key], val, true)
                // }


            } //else if ( typeof(originalRuleObj[nextFieldName]) != 'undefined' ) {
            //    field = nextFieldName;
            //}

            keys.splice(0,1);
            if (nextFieldName == _id) {
                rulesFromPath(obj[ _id ], keys, val, originalRuleObj, nextFieldName, i, len)
            } else if ( typeof(obj[ _id ]) != 'undefined' ) {
                rulesFromPath(obj[ _id ], keys, val, originalRuleObj, nextFieldName, i, len)
            } else {
                rulesFromPath(obj, keys, val, originalRuleObj, field, i, len)
            }

        }

        for (var prop in instance.rules) {
            if ( prop != ruleName && re.test(prop) ) {

                propName = prop.replace(propRe, '');
                if ( /\./.test(propName) ) {
                    var keys = propName.split(/\./g);
                    rulesFromPath( ruleObj, keys, instance.rules[prop], ruleObj, '',  0, ruleObj.count()-1 )
                }
            }
        }
        //cache rules
        local.rules[ruleName] = ruleObj;
        return ruleObj
    }


    /**
     * makeObjectFromArgs
     *
     *
     * @param {string} root
     * @param {array} args
     * @param {object} obj
     * @param {number} len
     * @param {number} i
     * @param {string|object} value
     * @param {object} [rootObj]
     *
     * @returns {Object} rootObj
     */
    var makeObjectFromArgs = function(_root, args, _obj, len, i, _value, _rootObj) {

        // Closure Compiler requirements
        var _global = window['gina']['_global'];
        // js_externs
        _global.register({
            'root'      : _root || null,
            'obj'       : _obj || null,
            'value'     : _value || null,
            'rootObj'   : _rootObj || null
        });


        if (i == len) { // end
            eval(root +'=value');
            // backup result
            var result = JSON.clone(rootObj);
            // cleanup _global
            _global.unregister(['root', 'obj', 'rootObj', 'value', 'valueType']);
            return result
        }

        var key = args[i].replace(/^\[|\]$/g, '');

        // init root object
        if ( typeof(rootObj) == 'undefined' || !rootObj ) {
            rootObj = {};
            root = 'rootObj';

            root += (/^\d+$/.test(key)) ? '['+ key + ']' : '["'+ key +'"]';
            eval(root +'=obj');
        } else {
            root += (/^\d+$/.test(key)) ? '['+ key + ']' : '["'+ key +'"]';
        }


        var nextKey = ( typeof(args[i + 1]) != 'undefined' ) ? args[i + 1].replace(/^\[|\]$/g, '') : null;
        var valueType = ( nextKey && parseInt(nextKey) == nextKey ) ? [] : {};
        _global.register({
            'valueType' : valueType
        });
        if ( nextKey ) {
            eval(root +' = valueType');
        }

        if ( typeof(obj[key]) == 'undefined' ) {

            if (/^\d+$/.test(nextKey)) { // collection index ?
                obj[key] = [];
            } else {
                obj[key] = {};
            }

            ++i;
            return makeObjectFromArgs(root, args, obj[key], len, i, value, rootObj);
        }

        ++i;
        return makeObjectFromArgs(root, args, obj[key], len, i, value, rootObj);
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

        var tmpObj = null;
        if ( Array.isArray(obj[key]) ) {
            //makeObjectFromArgs(obj[key], args, obj[key], args.length, 1, value);
            tmpObj = makeObjectFromArgs(key, args, obj[key], args.length, 1, value, null);
            obj[key] = merge(obj[key], tmpObj);
            makeObject(obj[key], value, args, len, i + 1);
        } else {
            if (i == len - 1) {
                obj[key] = value;
            }// else {
                makeObject(obj[key], value, args, len, i + 1)
            //}
        }
    }

    var formatData = function (data) {

        var args        = null
            , obj       = {}
            , key       = null
            , fields    = {}
            , altName   = null
        ;

        var makeFields = function(fields, isObject, data, len, i) {
            if (i == len ) { // exit
                return fields
            }

            var name = (isObject) ? Object.keys(data)[i] : i;

            if ( /\[(.*)\]/.test(name) ) {
                // backup name key
                key = name;
                // properties
                args    = name.match(/(\[[-_\[a-z 0-9]*\]\]|\[[-_\[a-z 0-9]*\])/ig);
                // root
                name    = name.match(/^[-_a-z 0-9]+\[{0}/ig);
                //altName = name.replace(/.*\[(.+)\]$/, "$1");

                if ( typeof(fields[name]) == 'undefined' ) {
                    fields[name] = ( Array.isArray(data[key]) ) ? [] : {};
                }
                // building object tree
                makeObject(obj, data[key], args, args.length, 0);

                fields[name] = merge(fields[name], obj);
                obj = {};

            } else { // normal case
                fields[name] = data[name];
            }
            name = null;
            altName = null;

            ++i;
            return makeFields(fields, isObject, data, len, i);
        }

        var len = ( typeof(data) == 'undefined' ) ? 0 : 1;// by default
        var isObject = false;
        if (Array.isArray(data)) {
            len = data.length;
        } else if ( typeof(data) == 'object' ) {
            len = data.count();
            isObject = true;
        }

        return makeFields(fields, isObject, data, len, 0);
        //return fields
    }

    var checkForDuplicateForm = function(id) {
        // check for duplicate form ids
        var $allForms = document.getElementsByTagName('form');
        var dID = null, duplicateFound = {};
        for (var d = 0, dLen = $allForms.length; d < dLen; ++d) {
            dID = $allForms[d].getAttribute('id') || null;
            if ( typeof(duplicateFound[dID]) == 'undefined'  ) {
                duplicateFound[dID] = true;
            } else {
                if ( typeof(instance.$forms[dID]) != 'undefined' && !instance.$forms[dID].warned) {
                    if (gina.popinIsBinded) {
                        console.warn('Popin/Validator::bindForm($target, customRule): `'+ dID +'` is a duplicate form ID. If not fixed, this could lead to an undesirable behaviour.\n Check inside your popin content');
                    } else {
                        console.warn('Validator::bindForm($target, customRule): `'+ dID +'` is a duplicate form ID. If not fixed, this could lead to an undesirable behaviour.');
                    }
                    instance.$forms[dID].warned = true;
                }
            }
        }
    }


    var setObserver = function ($el) {
        var $formInstance = instance.$forms[$el.form.getAttribute('id')];
        var isDisabled = ( /^true$/i.test($el.disabled) ) ? true : false;
        if (
            isDisabled
            && typeof($formInstance.rule) != 'undefined'
            && typeof($formInstance.rule[$el.name]) != 'undefined'
            && typeof($formInstance.rule[$el.name].exclude) != 'undefined'
            && /^false$/i.test($formInstance.rule[$el.name].exclude)
        ) {
            isDisabled = false;
        }
        // var allowedTypes = allowedLiveInputTypes.slice();
        if (!/^(radio|text|hidden|password|number|date|email)$/i.test($el.type) || isDisabled) {
            return;
        }

        // Credits to `Maciej Swist` @https://stackoverflow.com/questions/42427606/event-when-input-value-is-changed-by-javascript
        var descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
        var inputSetter = descriptor.set;

        //Then modify the "setter" of the value to notify when the value is changed:
        descriptor.set = function(val) {

            //changing to native setter to prevent the loop while setting the value
            Object.defineProperty(this, 'value', {set:inputSetter});

            var _evt = 'change.' + this.id;
            if ( val === this.value && val === this.defaultValue) {
                Object.defineProperty(this, 'value', descriptor);
                return;
            }
            if ( val === this.value) {
                //changing back to custom setter
                Object.defineProperty(this, 'value', descriptor);
                return;
            }

            this.value = val;
            // if (document.getElementById(this.id).value !== this.value) {
            //     document.getElementById(this.id).value = this.value;
            // }

            //Custom code triggered when $el.value is set
            console.debug('Value set: '+val);

            if ( typeof(gina.events[_evt]) != 'undefined' ) {
                console.debug('trigger event on: ', this.name, _evt);
                triggerEvent(gina, this, _evt, val);
            }
            //changing back to custom setter
            Object.defineProperty(this, 'value', descriptor);
        }

        //Last add the new "value" descriptor to the $el element
        Object.defineProperty($el, 'value', descriptor);
    }

    var addLiveForInput = function($form, $el, liveCheckTimer, isOtherTagAllowed) {

        if (typeof(isOtherTagAllowed) == 'undefined' ) {
            isOtherTagAllowed = false;
        }
        var rules = $form.rules;
        var $formInstance = instance.$forms[$el.form.getAttribute('id')];
        var isDisabled = ( /^true$/i.test($el.disabled) ) ? true : false;
        if (
            isDisabled
            && typeof($formInstance.rule) != 'undefined'
            && typeof($formInstance.rule[$el.name]) != 'undefined'
            && typeof($formInstance.rule[$el.name].exclude) != 'undefined'
            && /^false$/i.test($formInstance.rule[$el.name].exclude)
        ) {
            isDisabled = false;
        }
        // allowedLiveInputTypes
        if ( /^(radio|checkbox|text|hidden|password|number|date|email)$/i.test($el.type) && !isDisabled  || isOtherTagAllowed && !isDisabled ) {
            var field = $el.name;
            var localRule = rules[field] || null;
            if ( !localRule ) {
                checkForRuleAlias(rules, $el);

                if ( typeof(rules[field]) == 'undefined' )
                    return;
            }
            // data-gina-form-live-check-enabled
            // with local rule
            if ( $form.target.dataset.ginaFormLiveCheckEnabled && localRule) {

                var eventsList = [], _evt = null, _e = 0;
                if ( !/^(radio|checkbox)$/i.test($el.type) ) {
                    addEventListener(gina, $el, 'focusout.'+$el.id, function(event) {
                        event.preventDefault();
                        clearTimeout(liveCheckTimer);
                    });

                    // BO Livecheck local events
                    _evt = 'change.'+$el.id;
                    if ( typeof(gina.events[_evt]) == 'undefined' ) {
                        eventsList[_e] = _evt;
                        ++_e;
                    }

                    _evt = 'keyup.'+$el.id;
                    if ( typeof(gina.events[_evt]) == 'undefined' ) {
                        eventsList[_e] = _evt;
                        ++_e;
                    }
                    _evt = 'focusin.'+$el.id;
                    if ( typeof(gina.events[_evt]) == 'undefined' ) {
                        eventsList[_e] = _evt;
                        ++_e;
                    }
                    _evt = 'focusout.'+$el.id;
                    if ( typeof(gina.events[_evt]) == 'undefined' ) {
                        eventsList[_e] = _evt;
                        ++_e;
                    }
                    // EO Livecheck local events
                } else {
                    if ( /^(radio|checkbox)$/i.test($el.type) ) {
                        _evt = 'changed.'+$el.id;
                    } else {
                        _evt = 'change.'+$el.id;
                    }

                    if ( typeof(gina.events[_evt]) == 'undefined' ) {
                        eventsList[_e] = _evt;
                        ++_e;
                    }
                }

                if (eventsList.length > 0) {
                    var once = false;
                    addListener(gina, $el, eventsList, function(event) {
                        event.preventDefault();
                        clearTimeout(liveCheckTimer);
                        if ( !once && /^changed\./i.test(event.type) || !once && /^(radio|checkbox)$/i.test(event.target.type) ) {
                            once = true;
                        } else if (once && /^changed\./i.test(event.type) || once && /^(radio|checkbox)$/i.test(event.target.type) ) {
                            return false;
                        }

                        if (
                            typeof(instance.$forms[event.target.form.getAttribute('id')].isSubmitting) != 'undefined'
                            && /true/i.test(instance.$forms[event.target.form.getAttribute('id')].isSubmitting)
                        ) {
                            return false;
                        }

                        var processEvent = function() {

                            console.debug('processing: ' + event.target.name+ '/'+ event.target.id);

                            // Do not validate `onChange` if `input value` === `orignal value`
                            // Or else, you will get an endless loop
                            if (
                                // ignoring checkbox & radio because value for both have already changed
                                !/^(radio|checkbox)$/i.test(event.target.type)
                                && event.target.value === event.target.defaultValue
                                && event.target.value != ''
                            ) {
                                //resetting error display
                                var errors = instance.$forms[event.target.form.getAttribute('id')].errors;
                                if (!errors || errors.count() == 0) {
                                    handleErrorsDisplay(event.target.form, {}, null, event.target.name);
                                    return cancelEvent(event);
                                } else {
                                    handleErrorsDisplay(event.target.form, errors, null, event.target.name);
                                }
                                //return cancelEvent(event);
                            }


                            var localField = {}, $localField = {};
                            localField[event.target.name]     = event.target.value;
                            $localField[event.target.name]    = event.target;

                            instance.$forms[event.target.form.getAttribute('id')].isValidating = true;
                            validate(event.target, localField, $localField, $form.rules, function onLiveValidation(result){
                                instance.$forms[event.target.form.getAttribute('id')].isValidating = false;
                                //console.debug('validation on processEvent(...) ', result);

                                var isFormValid = result.isValid();
                                //console.debug('onSilentPreGlobalLiveValidation: '+ isFormValid, result);
                                if (isFormValid) {
                                    //resetting error display
                                    handleErrorsDisplay(event.target.form, {}, result.data, event.target.name);
                                } else {
                                    handleErrorsDisplay(event.target.form, result.error, result.data, event.target.name);
                                }
                                //updateSubmitTriggerState( event.target.form, isFormValid );
                                // data-gina-form-required-before-submit
                                //console.debug('====>', result.isValid(), result);

                                // Global check required: on all fields
                                var $gForm = event.target.form, gFields = null, $gFields = null, gRules = null;
                                var gValidatorInfos = getFormValidationInfos($gForm, rules);
                                gFields  = gValidatorInfos.fields;
                                $gFields = gValidatorInfos.$fields;
                                var formId = $gForm.getAttribute('id');
                                gRules   = instance.$forms[formId].rules;
                                // Don't be tempted to revome fields that has already been validated
                                instance.$forms[formId].isValidating = true;
                                validate($gForm, gFields, $gFields, gRules, function onSilentGlobalLiveValidation(gResult){
                                    instance.$forms[formId].isValidating = false;
                                    console.debug('['+ formId +'] onSilentGlobalLiveValidation: '+ gResult.isValid(), gResult);
                                    var isFormValid = gResult.isValid();
                                    if ( envIsDev && isGFFCtx && typeof(window.ginaToolbar) != 'undefined' && window.ginaToolbar ) {
                                        // update toolbar
                                        if (!gina.forms.errors)
                                            gina.forms.errors = {};

                                        var objCallback = {
                                            id      : formId,
                                            errors  :  gResult.error || {}
                                        };

                                        window.ginaToolbar.update('forms', objCallback);
                                    }


                                    updateSubmitTriggerState( $gForm, isFormValid);

                                    once = false;
                                })

                            });


                            return;
                        }

                        // radio & checkbox only
                        if (
                            /^changed\./i.test(event.type)
                            ||
                            /^change\./i.test(event.type)
                            && event.target.type == 'radio'
                        ) {
                            var i = 0;
                            return function(once, i) {
                                if (i > 0) return;
                                ++i;
                                return setTimeout(() => {
                                    console.debug(' changed .... '+$el.id);
                                    processEvent();
                                }, 0);

                            }(once, i)

                        }
                        // other inputs & textareas
                        else if ( /^focusin\./i.test(event.type) ) {
                            if ( /\-error/.test($el.parentNode.className) ) {
                                console.debug('#1 you just focusin ....'+$el.id, $el.value);
                                refreshWarning($el);
                            }
                        }
                        else if ( /^focusout\./i.test(event.type) ) {
                            if ( /\-warning/.test($el.parentNode.className) ) {
                                console.debug('#1 you just focusout ....'+$el.id, $el.value);
                                refreshWarning($el);
                                // in case error context is changed by another task
                                handleErrorsDisplay($el.form, instance.$forms[ $el.form.getAttribute('id') ].errors, null, $el.name);
                            }
                        }
                        else if ( /^keyup\./i.test(event.type) ) {
                            $el.ginaFormValidatorTestedValue = $el.value;
                            liveCheckTimer = setTimeout( function onLiveCheckTimer() {
                                // do not trigger for copy/paste event
                                if ( ['91', '17'].indexOf(''+event.keyCode) > -1  && keyboardMapping.count() == 0) {
                                    //console.debug('mapping ', keyboardMapping);
                                    return;
                                }
                                console.debug(' keyup ('+ event.keyCode +') .... '+$el.id, $el.value, ' VS ',$el.ginaFormValidatorTestedValue + '(old)');
                                processEvent();
                            }, 1000);
                        }
                        else if (/^change\./i.test(event.type) && !/^(checkbox)$/i.test(event.target.type) ) {
                            console.debug(' change .... '+$el.id);
                            processEvent();
                        }
                    });
                }
            }
        }
        return;
    }



    var setSelectionRange = function($el, selectionStart, selectionEnd) {
        if ($el.setSelectionRange) {
            $el.focus();
            $el.setSelectionRange(selectionStart, selectionEnd);
        }
        else if ($el.createTextRange) {
            var range = $el.createTextRange();
            range.collapse(true);
            range.moveEnd  ('character', selectionEnd  );
            range.moveStart('character', selectionStart);
            range.select();
        }
    }
    /**
     * setCaretToPos
     * If called after change of `readonly`, use `$el.blur()` before the call
     *
     * @param {object} $el - HTMLElement
     * @param {number} pos
     */
    var setCaretToPos = function ($el, pos) {
        setSelectionRange($el, pos, pos);
    }

    var isElementVisible = function($el) {
        return ($el.offsetWidth > 0 || $el.offsetHeight > 0 || $el === document.activeElement) ? true : false;
    }

    var focusNextElement = function($el, isGoingBackward) {
        // Add all elements we want to include in our selection
        // Checkboxes and radios are just ignored: like for the default behavior
        var focussableElements = 'a:not([disabled]), button:not([disabled]), input[type=text]:not([disabled]), select:not([disabled]), [tabindex]:not([disabled]):not([tabindex="-1"])';
        if (document.activeElement && document.activeElement.form) {
            var focussable = Array.prototype.filter.call(document.activeElement.form.querySelectorAll(focussableElements),
            function (element) {
                //Check for visibility while always include the current activeElement
                return element.offsetWidth > 0 || element.offsetHeight > 0 || element === document.activeElement
            });
            var index = focussable.indexOf(document.activeElement);
            if(index > -1) {
                var direcion = focussable[index + 1]; // By default, going forward
                if (isGoingBackward) {
                    direcion = focussable[index - 1]
                }
                var nextElement = direcion || focussable[0];
                nextElement.focus();
            }
        }
    }
    /**
     * handleAutoComplete
     * This is a temporary fix to handle safari autocomplete/autosuggest
     * Will be removed when Safari honores autocomplete="off"
     * @param {object} $el HTMLElement
     */
    var handleAutoComplete = function($el, liveCheckTimer) {
        $el.setAttribute('readonly', 'readonly');
        addListener(gina, $el, 'focusout.'+ $el.id, function(event) {
            event.preventDefault();
            clearTimeout(liveCheckTimer);

            var $_el = event.currentTarget;
            triggerEvent(gina, $_el, 'change.'+ $_el.id);
            $_el.setAttribute('readonly', 'readonly');
        });
        addListener(gina, $el, 'focusin.'+ $el.id, function(event) {
            event.preventDefault();
            event.currentTarget.removeAttribute('readonly');

            var evtName = 'keydown.'+ event.currentTarget.id;
            // add once
            if ( typeof(gina.events[evtName]) == 'undefined' ) {
                addListener(gina, event.currentTarget, evtName, function(e) {
                    e.preventDefault();
                    clearTimeout(liveCheckTimer);

                    var $_el = e.currentTarget;
                    var str = e.currentTarget.value;
                    var posStart = $_el.selectionStart, posEnd = $_el.selectionEnd;
                    $_el.removeAttribute('readonly');
                    //console.debug('pressed: '+ e.key+'('+ e.keyCode+')', ' S:'+posStart, ' E:'+posEnd, ' MAP: '+ JSON.stringify(keyboardMapping));
                    switch (e.keyCode) {
                        case 46: //Delete
                        case 8: //Backspace
                            if (posStart != posEnd) {
                                $_el.value = str.substr(0, posStart) + str.substr(posEnd);
                                if (posStart == 0) {
                                    $_el.value = str.substr(posEnd);
                                }
                            } else if (posStart == 0) {
                                $_el.value = str.substring(posStart+1);
                            } else {
                                $_el.value = str.substr(0, posStart-1) + str.substr(posEnd);
                            }

                            e.currentTarget.setAttribute('readonly', 'readonly');
                            setTimeout(() => {
                                $_el.removeAttribute('readonly');
                                setTimeout(() => {
                                    if (posStart != posEnd) {
                                        setCaretToPos($_el, posStart);
                                    } else if (posStart == 0) {
                                        setCaretToPos($_el, posStart);
                                    } else {
                                        setCaretToPos($_el, posStart-1);
                                    }
                                }, 0)

                            }, 0);
                            break;
                        case 9: // Tab
                            if (keyboardMapping[16] && keyboardMapping[9]) {
                                focusNextElement($_el, true);
                            } else {
                                focusNextElement($_el);
                            }
                            break;
                        case 13: // Enter
                        case 16: // Shift
                            break;
                        case 37: // ArrowLeft
                            console.debug('moving left ', posStart-1);
                            setCaretToPos($_el, posStart-1);
                            break;
                        case 39: // ArrowRight
                            if (posStart+1 < str.length+1) {
                                setCaretToPos($_el, posStart+1);
                            }
                            break;
                        // Shortcuts
                        case 17: //CTRL
                        case 91: //CMD
                            console.debug("CMD hit");
                            e.preventDefault();
                            break;
                        case 67: // to handle CMD+C (copy)
                            if (
                                keyboardMapping[67] && keyboardMapping[91] // mac osx
                                ||
                                keyboardMapping[67] && keyboardMapping[17] // windows
                            ) {
                                $_el.setSelectionRange(posStart, posEnd);
                                document.execCommand("copy");
                                break;
                            }
                        case 86: // to handle CMD+V (paste)
                            if (
                                keyboardMapping[86] && keyboardMapping[91] // mac osx
                                ||
                                keyboardMapping[86] && keyboardMapping[17] // windows
                            ) {
                                if (posStart != posEnd) {
                                    $_el.value = $_el.value.replace(str.substring(posStart, posEnd), '');
                                }
                                setCaretToPos($_el, posStart);
                                document.execCommand("paste");
                                break;
                            }
                        case 88: // to handle CMD+X (cut)
                            if (
                                keyboardMapping[88] && keyboardMapping[91] // mac osx
                                ||
                                keyboardMapping[88] && keyboardMapping[17] // windows
                            ) {
                                $_el.setSelectionRange(posStart, posEnd);
                                document.execCommand("cut");
                                break;
                            }
                        case 90: // to handle CMD+Z (undo)
                            if (
                                keyboardMapping[90] && keyboardMapping[91] // mac osx
                                ||
                                keyboardMapping[90] && keyboardMapping[17] // windows
                            ) {
                                $_el.value = $_el.defaultValue;
                                break;
                            }
                        default:
                            // Replace selection
                            if (posStart != posEnd) {
                                $_el.value = str.substr(0, posStart) + e.key;
                                if (posEnd-1 < str.length) {
                                    $_el.value += str.substring(posEnd)
                                }
                            } else if (posStart == 0) {
                                $_el.value = e.key + str.substring(posStart);
                            } else {
                                $_el.value = str.substr(0, posStart) + e.key + str.substr(posEnd);
                            }
                            e.currentTarget.setAttribute('readonly', 'readonly');
                            // Force restore last caret position
                            setTimeout(() => {
                                $_el.removeAttribute('readonly');
                                setTimeout(() => {
                                    setCaretToPos($_el, posStart+1);
                                }, 0);

                            }, 0);
                            break;
                    } //EO Switch
                });
            }

        });
    }

    var registerForLiveChecking = function($form, $el) {
        // Filter supported elements
        if (
            !/^(input|textarea)$/i.test($el.tagName)
            ||
            typeof(gina.events['registered.' + $el.id]) != 'undefined'
        ) {
            return
        }
        // Mutation obeserver - all but type == files
        if ( !/^file$/i.test($el.type) ) {
            setObserver($el);
        }
        var liveCheckTimer = null
        switch ($el.tagName.toLowerCase()) {

            case 'textarea':
                addLiveForInput($form, $el, liveCheckTimer, true);
                break;
            default:
                addLiveForInput($form, $el, liveCheckTimer);
                // Bypass Safari autocomplete
                var isAutoCompleteField = $el.getAttribute('autocomplete');
                if (
                    /safari/i.test(navigator.userAgent)
                    && isAutoCompleteField
                    && /^(off|false)/i.test(isAutoCompleteField)
                ) {
                    handleAutoComplete($el, liveCheckTimer)
                }
                break;
        }
        gina.events['registered.' + $el.id] = $el.id;
    }

    /**
     * bindUploadResetOrDeleteTrigger
     *
     * @param {string} bindingType - `reset`or `delete`
     * @param {object} $uploadTrigger - HTMLFormElement
     * @param {number} index
     *
     */
     var bindUploadResetOrDeleteTrigger = function(bindingType, $uploadTrigger, index) {

        // Binding upload reset or delete trigger
        // var $currentForm = $uploadTrigger.form;
        // for (let i = 0, len = $currentForm.length; )
        // trigger is by default you {input.id} + '-delete-trigger'
        // e.g.: <input type="file" id="my-upload" name="my-upload">
        // => <a href="/path/to/tmpfile/delete-action" id="my-upload-delete-trigger">Remove</a>
        // But you can use atrtibute `data-gina-form-upload-delete-trigger` to override it
        var uploadResetOrDeleteTriggerId = $uploadTrigger.id + '-' +index+ '-'+bindingType+'-trigger';
        var $uploadResetOrDeleteTrigger = document.getElementById(uploadResetOrDeleteTriggerId);
        if (!$uploadResetOrDeleteTrigger) {
            uploadResetOrDeleteTriggerId = $uploadTrigger.getAttribute('data-gina-form-upload-'+ '-' +index+ +bindingType+'-trigger');
            $uploadResetOrDeleteTrigger = document.getElementById(uploadResetOrDeleteTriggerId);
        }

        if (
            $uploadResetOrDeleteTrigger
            && typeof($uploadResetOrDeleteTrigger.isBinded) == 'undefined'
            ||
            $uploadResetOrDeleteTrigger
            && typeof($uploadResetOrDeleteTrigger.isBinded) != 'undefined'
            && !/true/i.test($uploadResetOrDeleteTrigger.isBinded)
        ) {
            addListener(gina, $uploadResetOrDeleteTrigger, 'click', function onUploadResetOrDeleteTriggerClick(e) {
                e.preventDefault();

                onUploadResetOrDelete($uploadTrigger, bindingType);
            });
            $uploadResetOrDeleteTrigger.isBinded = true;
        } else {
            console.warn('[FormValidator::bindForm][upload]['+$uploadTrigger.id+'] : did not find `upload '+bindingType+' trigger`.\nPlease, make sure that your delete element ID is `'+ uploadResetOrDeleteTriggerId +'-'+bindingType+'-trigger`, or add to your file input ('+ $uploadTrigger.id +') -> `data-gina-form-upload-'+bindingType+'-trigger="your-custom-id"` definition.');
        }
    }

    var checkUploadUrlActions = function($el, $errorContainer) {

        var checkAction = function($el, action, $errorContainer) {
            var defaultRoute = null;
            switch (action) {
                case 'data-gina-form-upload-action':
                    defaultRoute = 'upload-to-tmp-xml';
                    break;
                case 'data-gina-form-upload-reset-action':
                    defaultRoute = 'upload-delete-from-tmp-xml';
                    break;
            }
            var uploadActionUrl = $el.getAttribute(action);
            if (!uploadActionUrl || uploadActionUrl == '' ) {
                if (!defaultRoute)
                    console.warn('`'+ action +'` definition not found for `'+ $el.id + '`. Trying to get default route.');
                var additionalErrorDetails = null;
                try {
                    if (defaultRoute)
                        uploadActionUrl = routing.getRoute(defaultRoute);
                } catch (err) {
                    additionalErrorDetails = err;
                }

                if (uploadActionUrl) {
                    console.info('Ignore previous warnings regarding upload. I have found a default `'+action+'` route: `'+ defaultRoute +'@'+ uploadActionUrl.bundle +'`');
                    $el.setAttribute('data-gina-form-upload-action', uploadActionUrl.toUrl());
                } else {
                    var errMsg = '`'+ action +'` needs to be defined to proceed for your `input[type=file]` with ID `'+ $el.id +'`\n'+ additionalErrorDetails +'\n';
                    if ($errorContainer) {
                        $errorContainer.innerHTML += errMsg.replace(/(\n|\r)/g, '<br>');
                    }
                    console.error(errMsg);
                }
            }
        }
        // checking upload-action
        checkAction($el, 'data-gina-form-upload-action', $errorContainer);
        // checking upload-reset-action
        checkAction($el, 'data-gina-form-upload-reset-action', $errorContainer);
        // checking upload-delete-action
        checkAction($el, 'data-gina-form-upload-delete-action', $errorContainer);
    }

    /**
     * reBindForm - This is a WIP
     *
     * @param {object} HTMLElement
     * @param {object} rules
     * @returns {object} formValidatorInstance
     */
    var reBindForm = function($target, rules, cb) {
        // Unbind form
        var formInstance = unbindForm($target);
        // reset errors
        //resetErrorsDisplay(formInstance.id);
        // Bind
        bindForm(formInstance.target, rules);

        if ( cb ) {
            return cb(formInstance);
        }
        return formInstance;
    }

    var unbindForm = function($target) {
        var $form   = null
            , _id   = null
        ;

        try {
            if ( $target.getAttribute && $target.getAttribute('id') ) {
                _id = $target.getAttribute('id');
                if ( typeof(instance.$forms[_id]) != 'undefined')
                    $form = instance.$forms[_id];
                else
                    throw new Error('form instance `'+ _id +'` not found');

            } else if ( typeof($target.target) != 'undefined' ) {
                $form = $target;
                _id = $form.id;
            } else {
                throw new Error('Validator::unbindForm($target): `$target` must be a DOM element\n'+err.stack )
            }
        } catch(err) {
            throw new Error('Validator::unbindForm($target) could not unbind form `'+ $target +'`\n'+err.stack )
        }

        // No need to unbind if not binded
        if ( typeof($form) != 'undefined' && !$form.binded) {
            return $form
        }

        // form events
        removeListener(gina, $form, 'success.' + _id);
        removeListener(gina, $form, 'error.' + _id);

        if ($form.target.getAttribute('data-gina-form-event-on-submit-success'))
            removeListener(gina, $form, 'success.' + _id + '.hform');

        if ($form.target.getAttribute('data-gina-form-event-on-submit-error'))
            removeListener(gina, $form, 'error.' + _id + '.hform');

        removeListener(gina, $form, 'validate.' + _id);
        removeListener(gina, $form, 'validated.' + _id);
        removeListener(gina, $form, 'submit.' + _id);
        removeListener(gina, $form, 'reset.' + _id);



        // binded elements
        var $el         = null
            //, evt       = null
            , $els      = []
            , $elTMP    = [];

        // submit buttons
        $elTMP = $form.target.getElementsByTagName('button');
        if ( $elTMP.length > 0 ) {
            for(let i = 0, len = $elTMP.length; i < len; ++i) {
                // if button is != type="submit", you will need to provide : data-gina-form-submit
                // TODO - On button binding, you can then provide data-gina-form-action & data-gina-form-method
                $els.push($elTMP[i])
            }
        }

        // submit links
        $elTMP = $form.target.getElementsByTagName('a');
        if ( $elTMP.length > 0 ) {
            for(let i = 0, len = $elTMP.length; i < len; ++i) {
                $els.push($elTMP[i])
            }
        }

        // checkbox, radio, file, text, number, hidden, date .. ALL BUT hidden
        $elTMP = $form.target.getElementsByTagName('input');
        if ( $elTMP.length > 0 ) {
            for (let i = 0, len = $elTMP.length; i < len; ++i) {

                if ( !/^(hidden)$/i.test($elTMP[i].type) )
                    $els.push( $elTMP[i] );


                if (/^(file)$/i.test($elTMP[i].type)) {
                    // special case
                    // vForm has to be handle here, it does not exist in the document context
                    let vFormId = $elTMP[i].getAttribute('data-gina-form-virtual');
                    if ( vFormId ) {
                        let $vForm = getFormById(vFormId).target;
                        if ($vForm) {
                            $els.push( $vForm );
                            // `events` is defined on top of this file
                            // It is the list of allowed events
                            for (let e = 0, eLen = events.length; e < eLen; e++) {
                                let evt = events[e];
                                if ( typeof(gina.events[ evt +'.'+ vFormId + '.hform' ]) != 'undefined' && gina.events[ evt +'.'+ vFormId + '.hform' ] == vFormId ) {
                                    removeListener(gina, $vForm, evt +'.'+ vFormId + '.hform')
                                }
                            }
                        }
                    }
                } else { // other types
                    // `events` is defined on top of this file
                    // It is the list of allowed events
                    for (let e = 0, eLen = events.length; e < eLen; e++) {
                        let evt = events[e] +'.'+ $elTMP[i].id;
                        if ( typeof(gina.events[ evt ]) != 'undefined' && gina.events[ evt ] == $elTMP[i].id ) {
                            removeListener(gina, $elTMP[i], evt);
                        }
                        evt = events[e];
                        if ( typeof(gina.events[ evt ]) != 'undefined' && gina.events[ evt ] == $elTMP[i].id ) {
                            removeListener(gina, $elTMP[i], evt);
                        }
                        evt = $elTMP[i].id;
                        if ( typeof(gina.events[ evt ]) != 'undefined' && gina.events[ evt ] == $elTMP[i].id ) {
                            removeListener(gina, $elTMP[i], evt);
                        }
                    }
                }
            }
        }

        // textarea
        $elTMP = $form.target.getElementsByTagName('textarea');
        if ( $elTMP.length > 0 ) {
            for(let i = 0, len = $elTMP.length; i < len; ++i) {
                $els.push( $elTMP[i] )
            }
        }


        // forms inside main form
        $elTMP = $form.target.getElementsByTagName('form');
        if ( $elTMP.length > 0 ) {
            for(let i = 0, len = $elTMP.length; i < len; ++i) {
                $els.push( $elTMP[i] )
            }
        }
        // main form
        $els.push( $form.target );
        for (let i = 0, len = $els.length; i < len; ++i) {

            $el = $els[i];
            let eId = $el.getAttribute('id');
            for (let e = 0, eLen = events.length; e < eLen; e++) {
                let evt = events[e];
                let eventName = evt;
                // remove proxy
                // if ( typeof(gina.events[ evt ]) != 'undefined' ) {
                //     removeListener(gina, $el, evt);
                // }

                if ( typeof(gina.events[ eventName ]) != 'undefined' && gina.events[ eventName ] == eId ) {
                    removeListener(gina, $el, eventName);
                }

                // eventName = evt +'._case_'+ $el.name;
                // if ( typeof(gina.events[ eventName ]) != 'undefined') {
                //     removeListener(gina, $el, eventName);
                // }

                eventName = eId;
                if ( typeof(gina.events[ eventName ]) != 'undefined' && gina.events[ eventName ] == eId ) {
                    removeListener(gina, $el, eventName);
                }

                eventName = evt +'.'+ eId;
                if ( typeof(gina.events[ eventName ]) != 'undefined' && gina.events[ eventName ] == eId ) {
                    removeListener(gina, $el, eventName);
                }

                eventName = evt +'.'+ eId;
                if ( typeof(gina.events[ eventName ]) != 'undefined' && gina.events[ eventName ] == eventName ) {
                    removeListener(gina, $el, eventName);
                }

                eventName = evt +'.'+ eId + '.hform';
                if ( typeof(gina.events[ eventName ]) != 'undefined' && gina.events[ eventName ] == eId ) {
                    removeListener(gina, $el, eventName);
                }
            }// EO for events
        } //EO for $els

        $els = null; $el = null; $elTMP = null; evt = null;
        // reset error display
        //resetErrorsDisplay($form);
        // or
        // $form.target.dataset.ginaFormIsResetting = true;
        // handleErrorsDisplay($form.target, {});
        $form.binded = false;

        return $form;
    }

    var checkForRuleAlias = function(formRules, $el) {
        var field = $el.name;
        var localRule = formRules[field] || null;
        if ( !localRule ) {
            // looking for regexp aliases from rules
            for (let _r in formRules) {
                if ( /^\//.test(_r) ) { // RegExp found
                    re      = _r.match(/\/(.*)\//).pop();
                    flags   = _r.replace('/'+ re +'/', '');
                    // fix escaping "[" & "]"
                    re      = re.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
                    re      = new RegExp(re, flags);
                    if ( re.test(field)  ) {
                        // create new entry
                        localRule = formRules[field] = formRules[_r];
                        break;
                    }
                }
            }
        }
    }

    /**
     * bindForm
     *
     * @param {object} $target - DOM element
     * @param {object} [customRule]
     * */
    var bindForm = function($target, customRule) {

        var $form   = null
            , _id   = null
            , rules = ( typeof(local.rules.count() > 0 ) ) ? local.rules : instance.rules
        ;

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

        console.debug('binding for: '+ _id);


        var withRules = false, rule = null, evt = '', proceed = null;

        if (
            typeof(customRule) != 'undefined'
            ||
            typeof(_id) == 'string'
                && typeof(rules[_id.replace(/\-|\//g, '.')]) != 'undefined'
        ) {
            withRules = true;

            if ( customRule && typeof(customRule) == 'object' ) {
                rule = customRule
            } else if (
                customRule
                && typeof(customRule) == 'string'
                && typeof(rules[customRule.replace(/\-|\//g, '.')]) != 'undefined'
            ) {
                rule = getRuleObjByName(customRule.replace(/\-|\//g, '.'))
            } else {
                rule = getRuleObjByName(_id.replace(/\-|\//g, '.'))
            }

            $form.rules = rule;
            if ( envIsDev && isGFFCtx && typeof(window.ginaToolbar) != 'undefined' && window.ginaToolbar ) {
                // update toolbar
                if (!gina.forms.rules)
                    gina.forms.rules = {};

                objCallback = {
                    id      : _id,
                    rules  : $form.rules
                };

                window.ginaToolbar.update('forms', objCallback);
            }
        } else { // form without any rule binded
            $form.rules = {}
        }

        // Live check by default - data-gina-form-live-check-enabled
        if (
            typeof($form.target.dataset.ginaFormLiveCheckEnabled) == 'undefined'
            && $form.rules.count() > 0
        ) {
            $form.target.dataset.ginaFormLiveCheckEnabled = true;
        } else if( typeof($form.target.dataset.ginaFormLiveCheckEnabled) != 'undefined' ) {
            $form.target.dataset.ginaFormLiveCheckEnabled = ( /^true$/i.test($form.target.dataset.ginaFormLiveCheckEnabled) ) ? true : false;
        } else {
            $form.target.dataset.ginaFormLiveCheckEnabled = false;
        }

        // form fields collection
        if (!$form.fieldsSet)
            $form.fieldsSet = {};

        // binding form elements
        var type            = null
            , id            = null

            // a|links
            , $a            = $target.getElementsByTagName('a')
            // input type: checkbox, radio, hidden, text, files, number, date ...
            , $inputs       = $target.getElementsByTagName('input')
            // textarea
            , $textareas    = $target.getElementsByTagName('textarea')
            // select
            , $select       = $target.getElementsByTagName('select')
            , allFormGroupedElements = {}
            , allFormGroupNames = []
            , formElementGroup = {}
            , formElementGroupTmp = null
            , formElementGroupItems = {}
            // file upload
            , $htmlTarget = null
            , $progress = null
        ;

        var elId = null;

        // BO Binding a - not needed anymore since popin is binding link before binding child forms
        // for (let f = 0, len = $a.length; f < len; ++f) {
        //     let isPopinClick = false, hrefAttr = $a[f].getAttribute('href');
        //     if ( !hrefAttr || hrefAttr == '' ) {
        //         // Preventing popin auto to redirect to current/host page url
        //         $a[f].setAttribute('href', '#');
        //         isPopinClick = true;
        //     }
        //     elId = $a[f].getAttribute('id');
        //     if (!elId || elId == '') {
        //         elId = 'click.'; // by default
        //         if ( $target.isPopinContext ) {
        //             elId = ( isPopinClick ) ? 'popin.click.' : 'popin.link.';
        //         }
        //         elId += uuid.v4();
        //         $a[f].setAttribute('id', elId)
        //     }
        // }
        // EO Binding a

        // BO Binding textarea
        for (let f = 0, len = $textareas.length; f < len; ++f) {
            checkForRuleAlias($form.rules, $textareas[f]);
            elId = $textareas[f].getAttribute('id');
            if (!elId || elId == '') {
                elId = 'textareas.' + uuid.v4();
                $textareas[f].setAttribute('id', elId)
            }
            if (!$form.fieldsSet[ elId ]) {
                let defaultValue = $textareas[f].value || '';
                // // just in case
                // if (
                //     typeof($form.fieldsSet[elId]) != 'undefined'
                //     && typeof($form.fieldsSet[elId].defaultValue) != 'undefined'
                // ) {
                //     defaultValue = $form.fieldsSet[elId].defaultValue;
                // }
                $form.fieldsSet[elId] = {
                    id: elId,
                    name: $textareas[f].name || null,
                    value: $textareas[f].value || '',
                    defaultValue: defaultValue
                }
            }
            // Adding live check
            if (/^true$/i.test($form.target.dataset.ginaFormLiveCheckEnabled) ) {
                registerForLiveChecking($form, $textareas[f]);
            }

        }
        // EO Binding textarea

        // BO Binding input
        for (let f = 0, len = $inputs.length; f < len; ++f) {
            checkForRuleAlias($form.rules, $inputs[f]);
            elId = $inputs[f].getAttribute('id');
            if (!elId || elId == '') {
                elId = 'input.' + uuid.v4();
                $inputs[f].setAttribute('id', elId)
            }

            if (!$form.fieldsSet[ elId ]) {
                let defaultValue = $inputs[f].value;
                if (/$(on|true|false)$/i.test(defaultValue)) {
                    defaultValue = (/$(on|true)$/i.test(defaultValue)) ? true : false;
                }
                // just in case
                // if (
                //     typeof($form.fieldsSet[elId]) != 'undefined'
                //     && typeof($form.fieldsSet[elId].defaultValue) != 'undefined'
                // ) {
                //     defaultValue = $form.fieldsSet[elId].defaultValue;
                // }

                $form.fieldsSet[elId] = {
                    id: elId,
                    name: $inputs[f].name || null,
                    value: defaultValue || ( !/^(checkbox|radio)$/i.test($inputs[f].type) ) ? "" : $inputs[f].checked,
                    defaultValue: ( !/^(checkbox|radio)$/i.test($inputs[f].type) ) ? defaultValue : $inputs[f].checked
                }

                if ( /^(checkbox|radio)$/i.test($inputs[f].type) && typeof($form.fieldsSet[elId].defaultChecked) == 'undefined' ) {


                    $form.fieldsSet[elId].defaultChecked = (
                                                            /^(true|on)$/i.test($inputs[f].checked)
                                                            ||
                                                            /^(true|on)$/.test(defaultValue)
                                                            && /^(checkbox)$/i.test($inputs[f].type)
                                                        ) ? true : false;

                    if (/^radio$/i.test($inputs[f].type) ) {
                        $form.fieldsSet[elId].value = $inputs[f].value;
                        $form.fieldsSet[elId].defaultValue = $inputs[f].value;
                    }
                }
            }

            // Adding live check
            if (/^true$/i.test($form.target.dataset.ginaFormLiveCheckEnabled) ) {
                registerForLiveChecking($form, $inputs[f]);
            }

            formElementGroupTmp = $inputs[f].getAttribute('data-gina-form-element-group');
            if (formElementGroupTmp) {
                // recording group names
                if ( allFormGroupNames.indexOf(formElementGroupTmp) < 0 ) {
                    allFormGroupNames.push(formElementGroupTmp);
                }

                let _name = $inputs[f].getAttribute('name') || elId;
                if (_name === elId) {
                    $inputs[f].setAttribute('name', elId)
                }
                allFormGroupedElements[elId] = {
                    id      : elId,
                    name    : _name,
                    group   : formElementGroupTmp,
                    target  : $inputs[f]
                };
                formElementGroup[ $inputs[f].name ] = new RegExp('^'+formElementGroupTmp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
                // Attention, this means that all dependening field will be
                // ignored on validation, unless you write a rule that
                // will override this behavior or else your fields won't be submited
                // this behaviour only applies to Form Grouped Elements
                if (withRules) {
                    if ( typeof($form.rules[ $inputs[f].name ]) == 'undefined') {
                        $form.rules[ $inputs[f].name ] = {}
                    }
                    // By default exclude groups only if not required
                    // Those will be included if member of selected group
                    // See : handleGroupDependencies()
                    if (
                        typeof($form.rules[ $inputs[f].name ].isRequired) == 'undefined'
                        ||  !$form.rules[ $inputs[f].name ].isRequired
                    ) {
                        $form.rules[ $inputs[f].name ].exclude = true;
                    }
                }
            }
            // handling groups dependencies
            if ( formElementGroup.count() > 0 ) {
                var formElementGroupName = null, formElementGroupType = null, formElementIsIgnored = null;
                for ( var g in formElementGroup ) {
                    if ($inputs[f].name == g) continue;
                    // checkbox group init
                    formElementGroupName =  $inputs[f].getAttribute('data-gina-form-element-group') || null;
                    if ( formElementGroup[g].test($inputs[f].name) ) {
                        $inputs[f].disabled = true; // by default
                        if ( typeof(formElementGroupItems[ g ]) == 'undefined' ) {
                            formElementGroupItems[ g ] = {}
                        }
                        formElementGroupItems[ g ][ $inputs[f].name ] = $inputs[f];
                    }

                }
            }
            // Binding upload file
            // todo : data-gina-file-autosend="false" when false, don't trigger the sending to the backend
            // todo : progress bar
            // todo : on('success') -> preview
            if ( /^file$/i.test($inputs[f].type) ) {
                // Binding upload trigger
                // trigger is by default you {input.id} + '-trigger'
                // e.g.: <input type="file" id="my-upload" name="my-upload">
                // => <button type="button" id="my-upload-trigger">Choose a file</button>
                // But you can use atrtibute `data-gina-form-upload-trigger` to override it
                var uploadTriggerId = $inputs[f].getAttribute('data-gina-form-upload-trigger');
                if (!uploadTriggerId)
                    uploadTriggerId = $inputs[f].id;

                var $upload             = null
                    , $uploadTrigger    = null
                ;
                // `$htmlTarget` cannot be used if you need to add a listner on the searched element
                $htmlTarget = new DOMParser().parseFromString($target.innerHTML, 'text/html');
                if (uploadTriggerId) {
                    $uploadTrigger = document.getElementById(uploadTriggerId);
                    //$uploadTrigger = $htmlTarget.getElementById(uploadTriggerId);
                }
                var $errorContainer = document.getElementById($inputs[f].id + '-error');
                checkUploadUrlActions($inputs[f], $errorContainer );

                // check default UploadResetOrDeleteTrigger state
                // required to bind delete - look for all delete triggers
                // $deleteTriggers = [];
                // bindUploadResetOrDeleteTrigger(bindingType, $uploadTrigger, index);
                // eg.: document-files-0-preview; if $inputs[f].id === `document-files-0`
                var $previewContainer = $htmlTarget.getElementById(uploadTriggerId + '-preview');
                if (
                    $previewContainer
                    && $uploadTrigger
                    && !/none/i.test(window.getComputedStyle($previewContainer).display)
                    // for safety
                    && !/none/i.test($previewContainer.parentElement.style.display)
                ) {

                    var $deleteLink = null, index = 0, bindingType = 'delete';
                    console.debug('preview is visible ...');
                    $uploadTrigger.customFiles = [];
                    $uploadTrigger.form = $target;
                    var $els = $previewContainer.childNodes;
                    for (let i = 0, len = $els.length; i < len; i++) {
                        let $img = null;
                        if ( /ul/i.test($els[i].tagName) ) {
                            for (let e = 0, eLen = $els[i].length; e < eLen; e++) {
                                //let $li = new DOMParser().parseFromString($els[i].innerHTML, 'text/html');
                                let $li = $$els[i];
                                for (let l = 0, lLen = $li.length; l < lLen; l++) {
                                    if ( /img/i.test($li[l]) ) {
                                        $img = $li[l];
                                        $img.setAttribute('');

                                        index++;
                                    }
                                }

                            }
                        } else if ( /img/i.test($els[i].tagName) ) {
                            $img = $els[i];
                            deleteLinkId = uploadTriggerId + '-'+index+'-delete-trigger';
                            let file = $img.src.substr($img.src.lastIndexOf('/')+1);
                            $uploadTrigger.customFiles.push({
                                name: file,
                                deleteLinkId: deleteLinkId
                            });
                            // bind reset trigger
                            bindUploadResetOrDeleteTrigger(bindingType, $uploadTrigger, index);

                            index++;
                        }
                    }
                }

                // binding upload trigger
                // if ( $uploadTrigger ) {
                //     $uploadTrigger.setAttribute('data-gina-form-upload-target', $inputs[f].id);
                //     addListener(gina, $uploadTrigger, 'click', function(event) {
                //         event.preventDefault();
                //         var $el     = event.target;

                //         var fileElemId  = $el.getAttribute('data-gina-form-upload-target') || null;
                //         if (fileElemId)
                //             $upload = document.getElementById(fileElemId);

                //         if ($upload) {
                //             removeListener(gina, $upload, 'click');
                //             $upload.value = '';// force reset : != multiple
                //             triggerEvent(gina, $upload, 'click', event.detail);
                //         }
                //     });
                // }

                // binding file element == $upload
                // setTimeout(() => {
                //     removeListner(gina, $inputs[f], 'change');
                // }, 0);
                addListener(gina, $inputs[f], 'change', function(event) {
                    event.preventDefault();
                    var $el     = event.currentTarget;
                    // [0] is for a single file, when multiple == false
                    //var files = Array.from($el.files);
                    var files = $el.files;
                    // used for validation & onUploadResetOrDelete
                    $el.customFiles = Array.from(files);
                    if (!files.length ) return false;




                    // $progress = $($(this).parent().find('.progress'));
                    var url             = $el.getAttribute('data-gina-form-upload-action');
                    var name            = $el.getAttribute('name');
                    var fileId          = name;
                    var uploadFormId    = 'gina-upload-' + name.replace(/\[/g, '-').replace(/\]/g, '-' + $form.id);
                    $el.setAttribute('data-gina-form-virtual', uploadFormId);
                    var eventOnSuccess  = $el.getAttribute('data-gina-form-upload-on-success');
                    var eventOnError    = $el.getAttribute('data-gina-form-upload-on-error');
                    var errorField    = null;

                    if (files.length > 0) {

                        // create form if not exists
                        var $uploadForm = null, $activePopin = null;
                        if ( isPopinContext() ) {
                            // getting active popin
                            $activePopin = gina.popin.getActivePopin();
                            $activePopin.$target = new DOMParser().parseFromString($activePopin.target.outerHTML, 'text/html');
                            // binding to DOM
                            $activePopin.$target.getElementById($activePopin.id).innerHTML = document.getElementById($activePopin.id).innerHTML;

                            $uploadForm = $activePopin.$target.getElementById(uploadFormId);
                        } else {
                            $uploadForm = document.getElementById(uploadFormId);
                        }

                        if ( !$uploadForm ) {
                            try {
                                $uploadForm = getFormById(uploadFormId) || null;
                            } catch (noExistingFormErr) {
                                // do nothing
                            }

                            if (!$uploadForm) {
                                $uploadForm = (isPopinContext())
                                            ? $activePopin.$target.createElement('form')
                                            : document.createElement('form');
                            }


                            // adding form attributes
                            $uploadForm.id       = uploadFormId;
                            // setAttribute() not needed ?
                            //$uploadForm.setAttribute('id', uploadFormId);
                            $uploadForm.action   = url;
                            $uploadForm.enctype  = 'multipart/form-data';
                            $uploadForm.method   = 'POST';



                            if ( typeof($el.form) != 'undefined' ) {

                                // adding virtual fields
                                var fieldPrefix = 'files'; // by default
                                var fieldName   = $el.getAttribute('data-gina-form-upload-prefix') || $el.name || $el.getAttribute('name');
                                var fieldId     = $el.id || $el.getAttribute('id');

                                var hasPreviewContainer = false;
                                var previewContainer    = $el.getAttribute('data-gina-form-upload-preview') || fieldId + '-preview';
                                previewContainer        = (isPopinContext())
                                                        ? $activePopin.$target.getElementById(previewContainer)
                                                        : document.getElementById(previewContainer);

                                if ( typeof(previewContainer) != 'undefined' ) {
                                    hasPreviewContainer = true;
                                }

                                if (fieldName) {
                                    fieldPrefix = fieldName
                                }

                                var hiddenFields        = []
                                    , hiddenFieldObject = null
                                    , mandatoryFields   = [
                                        'name'
                                        , 'group'
                                        , 'originalFilename'
                                        , 'ext'
                                        , 'encoding'
                                        , 'size'
                                        , 'height' // will be removed depending on the mime type
                                        , 'width' // will be removed depending on the mime type
                                        , 'location'
                                        , 'mime'
                                        , 'preview'
                                    ]
                                    , formInputsFields  = $el.form.getElementsByTagName('INPUT')
                                    , fieldType         = null
                                    , hiddenField       = null
                                    , _userName         = null
                                    , _altId            = null
                                    , _name             = null
                                    , _nameRe           = null
                                    , subPrefix         = null
                                    , uploadFields      = {}
                                ;

                                for (var _f = 0, _fLen = files.length; _f < _fLen; ++_f) { // for each file
                                    // binding upload reset trigger
                                    bindUploadResetOrDeleteTrigger('reset', $el, _f);
                                    hiddenFields[_f] = null;
                                    subPrefix = fieldPrefix + '['+ _f +']';
                                    _nameRe = new RegExp('^'+subPrefix.replace(/\[/g, '\\[').replace(/\]/g, '\\]'));
                                    // collecting existing DOM fields
                                    for (var h = 0, hLen = formInputsFields.length; h < hLen; ++h) {
                                        fieldType   = formInputsFields[h].getAttribute('type');
                                        hiddenField = null;
                                        _name       = null, _userName = null;
                                        errorField= formInputsFields[h].getAttribute('data-gina-form-upload-error') || fieldId + '-error' || null;

                                        if (fieldType && /hidden/i.test(fieldType) ) {
                                            hiddenField = formInputsFields[h];

                                            _name       = ( /\[\w+\]$/i.test(hiddenField.name) )
                                                        ? hiddenField.name.match(/\[\w+\]$/)[0].replace(/\[|\]/g, '')
                                                        : hiddenField.name;
                                            _userName   = ( /\[\w+\]$/i.test(hiddenField.name) )
                                                        ? hiddenField.name.match(/\[\w+\]$/)[0].replace(/\[|\]/g, '')
                                                        : hiddenField.name;

                                            // mandatory informations
                                            if (
                                                hiddenField
                                                && typeof(_name) != 'undefiend'
                                                && mandatoryFields.indexOf( _name ) > -1
                                                && _nameRe.test( hiddenField.name )
                                            ) {

                                                if (!hiddenFields[_f] )
                                                    hiddenFields[_f] = {};

                                                if ( /\[preview\]/i.test(hiddenField.name) ) {
                                                    if ( typeof(hiddenFields[_f].preview) == 'undefined' )
                                                        hiddenFields[_f].preview = {};

                                                    hiddenFields[_f].preview[_name] = hiddenField;
                                                } else {
                                                    hiddenFields[_f][_name] = hiddenField;
                                                }
                                            } else if (
                                                hiddenField
                                                && typeof(_name) != 'undefiend'
                                                && mandatoryFields.indexOf( _name ) < 0
                                                && _nameRe.test( hiddenField.name )
                                            ) { // defined by user
                                                if (!hiddenFields[_f] )
                                                    hiddenFields[_f] = {};

                                                if ( /\[preview\]/i.test(hiddenField.name) ) {
                                                    if ( typeof(hiddenFields[_f].preview) == 'undefined' )
                                                        hiddenFields[_f].preview = {};

                                                    hiddenFields[_f].preview[_userName] = hiddenField;
                                                } else {
                                                    hiddenFields[_f][_userName] = hiddenField;
                                                }
                                            }
                                        }
                                    }

                                    // completing by adding non-declared mandatoring fields in the DOM: all but preview
                                    for (var m = 0, mLen = mandatoryFields.length; m < mLen; ++m) {
                                        // optional, must be set by user
                                        // needs recheck
                                        if (!hiddenFields[_f] )
                                            hiddenFields[_f] = {};

                                        if ( typeof(hiddenFields[_f][ mandatoryFields[m] ]) == 'undefined' ) {

                                            _name = fieldPrefix +'['+ _f +']['+ mandatoryFields[m] +']';
                                            // create input & add it to the form
                                            $newVirtualField = document.createElement('input');
                                            $newVirtualField.type = 'hidden';
                                            $newVirtualField.id = 'input.' + uuid.v4();
                                            $newVirtualField.name = _name;
                                            $newVirtualField.value = '';

                                            $el.form.appendChild($newVirtualField);
                                            hiddenFields[_f][ mandatoryFields[m] ] = $el.form[$el.form.length-1];// last added
                                        }

                                    }

                                } // EO for files

                                $uploadForm.uploadProperties = {
                                    id                  : $el.form.id || $el.getAttribute('id'),
                                    uploadTriggerId     : $el.id,
                                    $form               : $el.form,
                                    errorField          : errorField,
                                    mandatoryFields     : mandatoryFields,
                                    uploadFields        : hiddenFields,
                                    hasPreviewContainer : hasPreviewContainer,
                                    isPopinContext      : isPopinContext()
                                };
                                if (hasPreviewContainer) {
                                    $uploadForm.uploadProperties.previewContainer = previewContainer;
                                }
                            }

                            if (eventOnSuccess)
                                $uploadForm.setAttribute('data-gina-form-event-on-submit-success', eventOnSuccess);
                            else
                                $uploadForm.setAttribute('data-gina-form-event-on-submit-success', 'onGenericXhrResponse');

                            if (eventOnError)
                                $uploadForm.setAttribute('data-gina-form-event-on-submit-error', eventOnError);
                            else
                                $uploadForm.setAttribute('data-gina-form-event-on-submit-error', 'onGenericXhrResponse');


                            // adding for to current document
                            if (isPopinContext()) {
                                //$activePopin.$target.appendChild($uploadForm)
                                document.getElementById($activePopin.id).appendChild($uploadForm)
                            } else {
                                document.body.appendChild($uploadForm)
                            }
                        }

                        // binding form
                        try {
                            var $uploadFormValidator = getFormById(uploadFormId);
                            // create a FormData object which will be sent as the data payload
                            var formData = new FormData();
                            // add the files to formData object for the data payload
                            var file = null;
                            for (var l = 0, lLen = files.length; l < lLen; ++l) {
                                file = files[l];
                                formData.append(fileId, file, file.name);
                            }


                            $uploadFormValidator
                                // .on('error', function(e, result) {
                                //     console.error('[error] ', '\n(e)' + e, '\n(result)' + result)
                                // })
                                // .on('success', function(e, result){

                                //     var $el = e.target;
                                //     var $preview = null, $ul = null, $li = null, $img = null;
                                //     var previewId = $el.getAttribute('data-gina-form-upload-preview') || null;
                                //     if (previewId)
                                //         $preview = document.getElementById(previewId);


                                //     var files = result.files;
                                //     if ($preview) {
                                //         $preview.innerHTML = '';
                                //         $ul = document.createElement("ul");
                                //         for (var f = 0, fLen = files.length; f<fLen; ++f) {
                                //             $li = document.createElement("li");
                                //             $img = document.createElement("img");

                                //             $img.src = files[f].tmpSrc;
                                //             $img.width = files[f].width;
                                //             $img.height = files[f].height;

                                //             $li.appendChild($img);
                                //             $ul.appendChild($li);
                                //         }
                                //         $preview.appendChild($ul);
                                //     }

                                // })
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
                                .send(formData, { withCredentials: true/** , isSynchrone: true*/ });

                        } catch (formErr) {
                            throw formErr;
                        }
                    }
                });


            }
        }// EO Binding input

        var updateSelect = function($el, $form) {
            $el.setAttribute('data-value', $el.value);
            // If Live check enabled, proceed to silent validation
            if ( /^(true)$/i.test($form.target.dataset.ginaFormLiveCheckEnabled && $form.rules.count() > 0) ) {
                var localField = {}, $localField = {}, $localForm = null;
                $localForm = $el.form;//event.target.form
                localField[event.target.name]     = event.target.value;
                $localField[event.target.name]    = event.target;

                instance.$forms[$localForm.getAttribute('id')].isValidating = true;
                validate(event.target, localField, $localField, $form.rules, function onLiveValidation(result){
                    instance.$forms[$localForm.getAttribute('id')].isValidating = false;
                    var isFormValid = result.isValid();
                    //console.debug('onSilentPreGlobalLiveValidation: '+ isFormValid, result);
                    if (isFormValid) {
                        //resetting error display
                        handleErrorsDisplay($localForm, {}, result.data, event.target.name);
                    } else {
                        handleErrorsDisplay($localForm, result.error, result.data, event.target.name);
                    }
                    //updateSubmitTriggerState( $localForm, isFormValid );
                    // data-gina-form-required-before-submit
                    //console.debug('====>', result.isValid(), result);

                    // Global check required: on all fields
                    var $gForm = $localForm, gFields = null, $gFields = null, gRules = null;
                    var gValidatorInfos = getFormValidationInfos($gForm, rules);
                    gFields  = gValidatorInfos.fields;
                    $gFields = gValidatorInfos.$fields;
                    var formId = $gForm.getAttribute('id');
                    gRules   = instance.$forms[formId].rules;
                    // Don't be tempted to revome fields that has already been validated
                    instance.$forms[formId].isValidating = true;
                    validate($gForm, gFields, $gFields, gRules, function onSilentGlobalLiveValidation(gResult){
                        instance.$forms[formId].isValidating = false;
                        console.debug('[updateSelect]: onSilentGlobalLiveValidation: '+ gResult.isValid(), gResult);
                        var isFormValid = gResult.isValid();
                        updateSubmitTriggerState( $gForm, isFormValid);
                        once = false;
                    })

                });
            }
        };
        // BO binding select
        var selectedIndex = null, selectedValue = null;
        for (var s = 0, sLen = $select.length; s < sLen; ++s) {
            checkForRuleAlias($form.rules, $select[s]);

            elId = $select[s].getAttribute('id');

            if (elId && /^gina\-toolbar/.test(elId)) continue;

            if (!elId || elId == '') {
                elId = 'select.' + uuid.v4();
                $select[s].setAttribute('id', elId)
            }

            formElementGroupTmp = $select[s].getAttribute('data-gina-form-element-group');
            if (formElementGroupTmp) {
                let _name = $select[s].getAttribute('name') || elId;
                if (_name === elId) {
                    $select[s].setAttribute('name', elId)
                }
                allFormGroupedElements[elId] = {
                    id      : elId,
                    name    : _name,
                    group   : formElementGroupTmp,
                    target  : $select[s]
                };
            }

            addListener(gina, $select[s], 'change', function(event) {
                var $el = event.target;

                if (/select/i.test($el.type) ) {
                    updateSelect($el, $form);
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
                }

                $form.fieldsSet[ elId ] = {
                    id              : elId,
                    name            : $select[s].name || null,
                    value           : $select[s].options[ selectedIndex ].value || selectedValue || null,
                    selectedIndex   : selectedIndex || 0
                };

                // update select
                if ( typeof($select[s].selectedIndex) != 'undefined' ) {
                    $select[s].options[ selectedIndex ].selected = true;
                    $select[s].setAttribute('data-value',  $select[s].options[ selectedIndex ].value);
                }

            }
        }// EO binding select

        // group dependencies handling
        var updateReletadItems = function(elId, group, excluded, isCalledHasDependency) {

            if ( typeof(isCalledHasDependency) == 'undefined' ) {
                isCalledHasDependency = false;
            }

            if ( typeof(allFormGroupedElements[elId]) == 'undefined' ) {
                throw new Error('Radio & Checkbox dependencies not met: you must use the ID attribue of the `master element` as the `data-gina-form-element-group`')
            }

            var elIdIsChecked = null
                , re = null
                , re2 = null
                , namedId = elId.replace(/\-|\_|\@|\#|\.|\[|\]/g, '\\$&')
                //, name = $el.getAttribute('name').replace(/\-|\_|\@|\#|\.|\[|\]/g, '\\$&')
            ;
            elIdIsChecked = allFormGroupedElements[elId].target.checked;
            //console.debug('current id ', elId, excluded);
            for (let id in allFormGroupedElements) {
                // ignore triggers
                if ( /radio|checkbox/i.test(allFormGroupedElements[id].target.type) )
                    continue;

                let hasBeenUpdated = false;
                re = new RegExp(namedId);
                re2 = new RegExp(group);

                if (
                    re.test(allFormGroupedElements[id].group) && re2.test(allFormGroupedElements[id].group)
                    ||
                    re.test(allFormGroupedElements[id].group)
                ) {
                    // init default state: disable all;
                    allFormGroupedElements[id].target.disabled = true;
                    // adding custom rule for this case
                    if ( typeof($form.rules[ allFormGroupedElements[id].name ]) == 'undefined' ) {
                        $form.rules[ allFormGroupedElements[id].name ] = {}
                    }
                    $form.rules[ allFormGroupedElements[id].name ].exclude = true;

                    // triggered by click on the radio group
                    if (isCalledHasDependency) {
                        //console.debug('In Group #1 ', 'excluded:'+excluded, 'disabled:'+allFormGroupedElements[id].target.disabled, allFormGroupedElements[id].name, checkBoxGroup, ' VS ', allFormGroupedElements[id].group);
                        allFormGroupedElements[id].target.disabled = (elIdIsChecked) ? false : true;
                        $form.rules[ allFormGroupedElements[id].name ].exclude = (elIdIsChecked) ? false : true;
                        //console.debug('In Group #1 fixed to -> ', 'excluded:'+excluded, 'disabled:'+allFormGroupedElements[id].target.disabled);
                        continue;
                    }
                    // triggered by click on the checkbox
                    //console.debug('In Group #2 ', 'excluded:'+excluded, 'disabled:'+allFormGroupedElements[id].target.disabled, allFormGroupedElements[id].name, checkBoxGroup, ' VS ', allFormGroupedElements[id].group);
                    allFormGroupedElements[id].target.disabled = excluded;
                    $form.rules[ allFormGroupedElements[id].name ].exclude = excluded;
                    //console.debug('In Group #2 fixed to -> ', 'excluded:'+excluded, 'disabled:'+allFormGroupedElements[id].target.disabled);
                    continue;
                }
                //console.debug('elId: '+elId, 'isCalledHasDependency:'+isCalledHasDependency, 'hasBeenUpdated:'+ hasBeenUpdated, 'excluded:'+excluded, 'disabled:'+allFormGroupedElements[id].target.disabled, allFormGroupedElements[id].name, 'elIdIsChecked:'+elIdIsChecked, 'inGroup:'+re.test(allFormGroupedElements[id].group) );

            }

            return
        };
        var handleCheckBoxGroupDependencies = function($form, $el, checkBoxGroup, isCalledHasDependency) {


            if ( typeof(isCalledHasDependency) == 'undefined' ) {
                isCalledHasDependency = false;
            }
            if (isCalledHasDependency && typeof(allFormGroupedElements[$el.id]) != 'undefined' ) {
                var excluded = /true/i.test($el.checked) ? false : true;
                return updateReletadItems($el.id, allFormGroupedElements[$el.id].group, excluded, isCalledHasDependency)
            }


            var item = $el.name;
            if (withRules && typeof($form.rules[item]) == 'undefined' ) {
                $form.rules[item] = {}
            }
            if ( /^true$/i.test($el.checked) ) {
                if (withRules) {
                    $form.rules[item].exclude = false;
                    if ( typeof(allFormGroupedElements[$el.id]) != 'undefined' ) {
                        updateReletadItems($el.id, allFormGroupedElements[$el.id].group, false, isCalledHasDependency)
                    }
                }
            } else {
                //elGroup[item].disabled = true;
                if (withRules) {
                    $form.rules[item].exclude = true;
                    if ( typeof(allFormGroupedElements[$el.id]) != 'undefined' ) {
                        updateReletadItems($el.id, allFormGroupedElements[$el.id].group, true, isCalledHasDependency)
                    }
                }
            }
        };
        var updateCheckBox = function($el, isInit) {
            if ( typeof(isInit) == 'undefined' ) {
                isInit = false;
            }

            var triggerHandleCheckBoxGroupDependencies = function($el, checkBoxGroup, isExcluded) {
                if (checkBoxGroup) {
                    handleCheckBoxGroupDependencies($form, $el, checkBoxGroup);
                } else {
                    for (let id in allFormGroupedElements) {
                        if (
                            re.test(allFormGroupedElements[id].group)
                            ||
                            re.test(allFormGroupedElements[id].target.getAttribute('data-gina-form-element-group'))
                        ) {
                            allFormGroupedElements[id].target.disabled = isExcluded;
                        }
                    }
                }
            }

            // Preventing jQuery setting `on` value when input is not checked
            if (isInit && /^(on)$/i.test($el.value) && !$el.checked) {
                $el.value = false
            }
            var localValue  = $el.getAttribute('data-value') || $el.getAttribute('value') || $el.value;
            localValue = (/^(true|on)$/.test(localValue)) ? true : localValue;

            if (localValue === '') {
                localValue = false
            }
            var isLocalBoleanValue = ( /^(true|on|false)$/i.test(localValue) ) ? true : false;
            if (isInit && isLocalBoleanValue) { // on checkbox init
                // update checkbox initial state
                // Value defines checked state by default
                if ( /^true$/i.test(localValue) && !$el.checked) {
                    $el.checked = true;
                } else if ( /^false$/i.test(localValue) && $el.checked) {
                    $el.checked = false;
                }
            }
            var checked     = $el.checked;

            var checkBoxGroup   = $el.getAttribute('data-gina-form-element-group') || null;
            var re              = new RegExp($el.id.replace(/\-|\_|\@|\#|\.|\[|\]/g, '\\$&'));
            // set to checked if not checked: false -> true
            if ( !checked || checked == 'null' || checked == 'false' || checked == '' ) {

                // prevents ticking behavior
                if (!isInit) {
                    setTimeout(function () {
                        $el.checked = false;
                        // means that the checkbox is member of another group
                        triggerHandleCheckBoxGroupDependencies($el, checkBoxGroup, true);
                        updateGroupChildrenState($el);
                    }, 0);
                } else {
                    updateGroupChildrenState($el);
                }


                $el.removeAttribute('checked');
                if (isLocalBoleanValue) {
                    $el.value = false;
                    $el.setAttribute('value', 'false');
                    if ( typeof($el.getAttribute('data-value') != 'undefined' ) )
                        $el.setAttribute('data-value', 'false');
                }


            } else {

                // prevents ticking behavior
                if (!isInit) {
                    setTimeout(function () {
                        $el.checked = true;
                        // means that the checkbox is member of another group
                        triggerHandleCheckBoxGroupDependencies($el, checkBoxGroup, false);
                        updateGroupChildrenState($el);
                    }, 0);
                    $el.setAttribute('checked', 'checked');
                } else {
                    updateGroupChildrenState($el);
                }

                if (isLocalBoleanValue) {
                    $el.value = true;
                    $el.setAttribute('value', true);
                    if ( typeof($el.getAttribute('data-value') != 'undefined' ) )
                        $el.setAttribute('data-value', true);
                }

            }
        };

        var updateGroupChildrenState = function($groupMaster) {
            var re = new RegExp($groupMaster.id.replace(/\-|\_|\@|\#|\.|\[|\]/g, '\\$&'));
            // Handle extended groups
            for (let id in allFormGroupedElements) {
                if (
                    /checkbox/i.test(allFormGroupedElements[id].target.type) && re.test(allFormGroupedElements[id].group)
                    ||
                    /checkbox/i.test(allFormGroupedElements[id].target.type) && re.test(allFormGroupedElements[id].target.getAttribute('data-gina-form-element-group'))
                ) {
                    handleCheckBoxGroupDependencies($form, allFormGroupedElements[id].target, allFormGroupedElements[id].group, true);
                }
            }
        }

        // When binding children element to the radio, you must used the radio.id as the element group
        // Because the name attribute of the radio can also be used to group multiple radio field
        // On master: <input type="radio" id="invoice-type-balance" name="action[addFromExisting]" value="balanceFlow">
        // On children: <input type="checkbox" data-gina-form-element-group="invoice-type-balance" value="someValue">
        var handleGroupDependencies = function($el, isOnResetMode) {
            isOnResetMode = ( typeof(isOnResetMode) != 'undefined' && isOnResetMode) ? true: false;

            //console.debug('reset: '+isOnResetMode, $el.id, $el.checked);
            var extendedGroupName = $el.id.replace(/\-|\_|\@|\#|\.|\[|\]/g, '\\$&')
                , re = null
            ;
            // parse grouped elements: allFormGroupedElements
            // init
            re = new RegExp(extendedGroupName);
            for (let id in allFormGroupedElements) {
                if (!/checkbox|radio/i.test(allFormGroupedElements[id].target.type)) {
                    allFormGroupedElements[id].target.disabled = true;
                    // adding custom rule for this case
                    if ( typeof($form.rules[ allFormGroupedElements[id].name ]) == 'undefined' ) {
                        $form.rules[ allFormGroupedElements[id].name ] = {}
                    }
                    $form.rules[ allFormGroupedElements[id].name ].exclude = true;
                }

                if (
                    re.test(allFormGroupedElements[id].group)
                    ||
                    re.test(allFormGroupedElements[id].target.getAttribute('data-gina-form-element-group').replace(/\-|\_|\@|\#|\.|\[|\]/g, '\\$&'))
                ) {
                    // init default
                    allFormGroupedElements[id].target.disabled = true;
                    // adding custom rule for this case
                    if ( typeof($form.rules[ allFormGroupedElements[id].name ]) == 'undefined' ) {
                        $form.rules[ allFormGroupedElements[id].name ] = {}
                    }

                    if (/^(true|on)$/i.test($el.checked)) {
                        allFormGroupedElements[id].target.disabled = false;
                        $form.rules[ allFormGroupedElements[id].name ].exclude = false;
                    } else {
                        allFormGroupedElements[id].target.disabled = true;
                        $form.rules[ allFormGroupedElements[id].name ].exclude = true;
                    }
                }
            }
            // Handle extended groups
            updateGroupChildrenState($el);
        }

        // BO Binding radio
        var radioGroup = null;
        var updateRadio = function($el, isInit, isTriggedByUser) {
            isInit = ( typeof(isInit) == 'undefined' || !isInit ) ? false : true;
            isTriggedByUser = ( typeof(isTriggedByUser) == 'undefined' || !isTriggedByUser ) ? false : true;

            var checked = $el.checked, evt = null;
            var isBoolean = /^(true|false)$/i.test($el.value);
            radioGroup = document.getElementsByName($el.name);

            // loop if radio group
            for (let r = 0, rLen = radioGroup.length; r < rLen; ++r) {
                if (radioGroup[r].id !== $el.id && checked) {
                    radioGroup[r].checked = false;
                    radioGroup[r].removeAttribute('checked');
                    handleGroupDependencies(radioGroup[r], true)
                }
            }


            if (isInit) {
                handleGroupDependencies($el);
                return;
            }

            if ( !checked || checked == 'null' || checked == 'false' || checked == '' ) {

                // prevents ticking behavior
                setTimeout(function () {
                    if (isTriggedByUser) {
                        handleGroupDependencies($el);
                        return;
                    }
                    $el.checked = true;
                    $el.setAttribute('checked', 'checked');
                }, 0)

            } else {

                // prevents ticking behavior
                setTimeout(function () {
                    if (isTriggedByUser) {
                        handleGroupDependencies($el);
                        return;
                    }
                    $el.checked = false;
                    $el.removeAttribute('checked');
                }, 0)
            }

            if (isBoolean) { // force boolean value
                $el.value = (/^true$/.test($el.value)) ? true : false
            }
            // fix added on 2020/09/25 :
            return;
        }// EO Binding radio

        for (var i = 0, iLen = $inputs.length; i < iLen; ++i) {
            type    = $inputs[i].getAttribute('type');

            if ( typeof($inputs[i].id) == 'undefined' || $inputs[i].id == '' ) {
                $inputs[i].id = type +'-'+ uuid.v4();
                $inputs[i].setAttribute('id', $inputs[i].id)
            }


            // recover default state only on value === true || false || on
            if (
                typeof(type) != 'undefined'
                && /^checkbox$/i.test(type)
            ) {

                // if is master of a group, init children default state
                if (
                    $inputs[i].disabled
                    && allFormGroupNames.indexOf($inputs[i].id) > -1
                    ||
                    !$inputs[i].checked
                    && allFormGroupNames.indexOf($inputs[i].id) > -1
                ) {
                    // updateGroupChildrenState($inputs[i]);
                    let re = new RegExp( $inputs[i].id.replace(/\-|\_|\@|\#|\.|\[|\]/g, '\\$&') );
                    for (let childElement in allFormGroupedElements ) {
                        if ( re.test(allFormGroupedElements[childElement].group) ) {
                            allFormGroupedElements[childElement].target.disabled = true;
                        }
                    }
                }

                evt = 'change.'+ $inputs[i].id;
                proceed = function ($el, evt) {

                    // recover default state only on value === true || false
                    addListener(gina, $el, evt, function(event) {
                        updateCheckBox(event.target);

                        triggerEvent(gina, event.target, 'changed.'+ event.target.id);
                    });

                    // default state recovery
                    updateCheckBox($el, true);
                }

                if ( typeof(gina.events[evt]) != 'undefined' && gina.events[evt] == $inputs[i].id ) {
                    removeListener(gina, $inputs[i], evt);
                    proceed($inputs[i], evt)

                } else {
                    proceed($inputs[i], evt)
                }

            } else if (
                typeof(type) != 'undefined'
                && /^radio$/i.test(type)
            ) {

                evt = $inputs[i].id;
                //evt = 'change.'+ $inputs[i].id;

                proceed = function ($el, evt) {
                    // recover default state
                    addListener(gina, $el, evt, function(event) {
                        //cancelEvent(event);
                        updateRadio(event.target);

                        triggerEvent(gina, event.target, 'changed.'+ event.target.id);
                    });

                    // default state recovery
                    updateRadio($el, true);
                }

                if ( typeof(gina.events[evt]) != 'undefined' && gina.events[evt] == $inputs[i].id ) {
                    removeListener(gina, $inputs[i], evt);
                    proceed($inputs[i], evt);
                } else {
                    proceed($inputs[i], evt)
                }
            }
        }


        evt = 'click';

        proceed = function () {
            var subEvent = null;
            // handle form reset
            subEvent = 'reset.'+$target.id;
            if ( typeof(gina.events[subEvent]) == 'undefined' ) {
                addListener(gina, $target, subEvent, function(e) {
                    e.preventDefault();

                    var _id             = e.currentTarget.id || e.target.id
                    var $form           = instance.$forms[_id];
                    $form.target.dataset.ginaFormIsResetting = true;
                    resetFields($form);
                    // forcing it
                    var validationInfo  = getFormValidationInfos($form.target, $form.rules, true);
                    var fields          = validationInfo.fields;
                    var $fields         = validationInfo.$fields;

                    validate($form.target, fields, $fields, $form.rules, function onSilentResetValidation(result){
                        var isFormValid = result.isValid();
                        console.debug('silent reset validation result[isValid:'+isFormValid+']: ', result);
                        //resetting error display
                        handleErrorsDisplay($form.target, {});

                        updateSubmitTriggerState( $form.target , isFormValid );
                        $form.target.dataset.ginaFormIsResetting = false;
                    });
                })
            }
            // reset proxy
            addListener(gina, $target, 'reset', function(event) {
                var $el = event.target;
                // prevent event to be triggered twice
                if (
                    typeof(event.defaultPrevented) != 'undefined'
                    && event.defaultPrevented
                ) {
                    return false;
                }
                // Fixed on 2021/06/08 - because of radio reset
                event.preventDefault();

                var _evt = $el.id;
                if (!_evt) return false;

                if ( !/^reset\./.test(_evt) ) {
                    _evt = 'reset.'+$el.id
                }
                if (gina.events[_evt]) {
                    triggerEvent(gina, $el, _evt, event.detail);
                }
            });
            // keydown proxy
            addListener(gina, $target, 'keydown', function(event) {
                var $el = event.target;
                // prevent event to be triggered twice
                if ( typeof(event.defaultPrevented) != 'undefined' && event.defaultPrevented )
                return false;

                keyboardMapping[event.keyCode] = event.type == 'keydown';

                var _evt = $el.id;
                if (!_evt) return false;

                if ( !/^keydown\./.test(_evt) ) {
                    _evt = 'keydown.'+$el.id
                }
                if (gina.events[_evt]) {
                    cancelEvent(event);
                    triggerEvent(gina, $el, _evt, event.detail, event);
                }
            });
            // keyup proxy - updating keyboardMapping
            addListener(gina, $target, 'keyup', function(event) {
                var $el = event.target;
                // prevent event to be triggered twice
                if ( typeof(event.defaultPrevented) != 'undefined' && event.defaultPrevented )
                return false;

                if (keyboardMapping[event.keyCode]) {
                    delete keyboardMapping[event.keyCode]
                }

                var _evt = $el.id;
                if (!_evt) return false;
                if ( !/^keyup\./.test(_evt) ) {
                    _evt = 'keyup.'+$el.id
                }
                if (gina.events[_evt]) {
                    cancelEvent(event);
                    triggerEvent(gina, $el, _evt, event.detail, event);
                }
            });

            // focusin proxy
            addListener(gina, $target, 'focusin', function(event) {
                var $el = event.target;
                // prevent event to be triggered twice
                if ( typeof(event.defaultPrevented) != 'undefined' && event.defaultPrevented )
                return false;

                var _evt = $el.id;
                if (!_evt) return false;

                if ( !/^focusin\./.test(_evt) ) {
                    _evt = 'focusin.'+$el.id
                }
                if (gina.events[_evt]) {
                    cancelEvent(event);

                    triggerEvent(gina, $el, _evt, event.detail);
                }
            });
            // focusout proxy
            addListener(gina, $target, 'focusout', function(event) {
                // Never preventDefault from a proxy listner
                var $el = event.target;
                // prevent event to be triggered twice
                if ( typeof(event.defaultPrevented) != 'undefined' && event.defaultPrevented )
                    return false;

                var _evt = $el.id;
                if (!_evt) return false;

                if ( !/^focusout\./.test(_evt) ) {
                    _evt = 'focusout.'+$el.id
                }
                if (gina.events[_evt]) {
                    cancelEvent(event);

                    triggerEvent(gina, $el, _evt, event.detail);
                }
            });

            // change proxy
            addListener(gina, $target, 'change', function(event) {
                // Never preventDefault from a proxy listner
                var $el = event.target;
                // prevent event to be triggered twice
                if ( typeof(event.defaultPrevented) != 'undefined' && event.defaultPrevented )
                return false;

                var _evt = $el.id;
                if (!_evt) return false;

                if ( !/^change\./.test(_evt) ) {
                    _evt = 'change.'+$el.id
                }
                if (gina.events[_evt]) {
                    cancelEvent(event);
                    triggerEvent(gina, $el, _evt, event.detail);
                }
            });
            // click proxy
            addListener(gina, $target, 'click', function(event) {
                // Never preventDefault from a proxy listner
                var $el = event.target;
                // prevent event to be triggered twice
                // if ( typeof(event.defaultPrevented) != 'undefined' && event.defaultPrevented )
                //     return false;

                var isCustomSubmit = false, isCaseIgnored = false;

                if (
                    /(label)/i.test(event.target.tagName)
                        && typeof(event.target.control) != 'undefined'
                        && event.target.control != null
                        && /(checkbox|radio)/i.test(event.target.control.type)
                    ||
                    /(label)/i.test(event.target.parentNode.tagName)
                        && typeof(event.target.parentNode.control) != 'undefined'
                        && event.target.parentNode.control != null
                        && /(checkbox|radio)/i.test(event.target.parentNode.control.type)
                ) {
                    var isCaseIgnored = (
                                        event.target.getAttribute('for')
                                        ||
                                        event.target.parentNode.getAttribute('for')
                                    ) ? true : false
                    ;
                    // if `event.target.control` not working on all browser,
                    // try to detect `for` attribute OR check if on of the label's event.target.children is an input & type == (checkbox|radio)
                    $el = event.target.control || event.target.parentNode.control;

                }
                if (
                    !$el.disabled
                    && /(checkbox|radio)/i.test($el.type)
                    && !isCaseIgnored
                ) {
                    // apply checked choice : if true -> set to false, and if false -> set to true
                    if ( /checkbox/i.test($el.type) ) {
                        return updateCheckBox($el);
                    } else if ( /radio/i.test($el.type) ) {
                        return updateRadio($el, false, true);
                    }
                }


                // include only these elements for the binding
                if (
                    /(button|input)/i.test($el.tagName) && /(submit|checkbox|radio)/i.test($el.type)
                    || /a/i.test($el.tagName) && $el.attributes.getNamedItem('data-gina-form-submit')
                    // You could also have a click on a child element like <a href="#"><span>click me</span></a>
                    || /a/i.test($el.parentNode.tagName) && $el.parentNode.attributes.getNamedItem('data-gina-form-submit')
                ) {
                    var namedItem = $el.attributes.getNamedItem('data-gina-form-submit');
                    var parentNamedItem = $el.parentNode.attributes.getNamedItem('data-gina-form-submit');
                    if (
                        namedItem
                        ||
                        parentNamedItem
                    ) {
                        isCustomSubmit = true;
                        // Get others attribute and override current form attribute
                        var newFormMethod = null;
                        if (namedItem) {
                            newFormMethod = $el.getAttribute('data-gina-form-submit-method');
                        } else {
                            newFormMethod = $el.parentNode.getAttribute('data-gina-form-submit-method');
                        }
                        if (newFormMethod) {
                            // Backup originalMethod

                            // Rewrite current method
                            if (namedItem && $el.form) {
                                $el.form.setAttribute('method', newFormMethod);
                            } else if ($el.parentNode.form) {
                                $el.parentNode.form.setAttribute('method', newFormMethod);
                            }
                        }
                    }

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

                        // normal case
                        if (
                            !$el.disabled
                            && /(checkbox|radio)/i.test($el.type)
                        ) {
                            //event.stopPropagation();
                            // apply checked choice : if true -> set to false, and if false -> set to true
                            if ( /checkbox/i.test($el.type) ) {
                                return updateCheckBox($el);
                            } else if ( /radio/i.test($el.type) ) {
                                return updateRadio($el, false, true);
                            }
                        }

                        // prevent event to be triggered twice
                        if ( typeof(event.defaultPrevented) != 'undefined' && event.defaultPrevented )
                            return false;

                        // in case we have multiple submit type buttons
                        if ( $el.type == 'submit' && !/^submit\./i.test(_evt) ) {
                            _evt = 'submit.'+_evt
                        }
                        // in case we have multiple reset type buttons
                        if ( $el.type == 'reset' && !/^reset\./i.test(_evt) ) {
                            _evt = 'reset.'+_evt
                        }

                        if (gina.events[_evt]) {
                            cancelEvent(event);

                            triggerEvent(gina, $el, _evt, event.detail);
                        } else if (
                            isCustomSubmit
                            && typeof(this.id) != 'undefined'
                            && this.id != ''
                            && typeof(gina.validator.$forms[this.id]) != 'undefined'
                        ) {
                            gina.validator.getFormById(this.id).submit();
                            cancelEvent(event); // stop #navigation
                        }

                    }
                }

            })
        }

        proceed();





        evt = 'validate.' + _id;
        proceed = function () {
            // attach form submit event
            addListener(gina, $target, evt, function(event) {
                cancelEvent(event);

                //var result = event['detail'] || $form.eventData.error || $form.eventData.validation;
                var result = $form.eventData.error || $form.eventData.validation || event['detail'];
                // TODO - Since $form.eventData.error is cached, add a TTL to clear it and allow re $validator.send()
                handleErrorsDisplay(event['target'], result['fields']||result['error'], result['data']);

                var _id = event.target.getAttribute('id');

                if ( typeof(result['isValid']) != 'undefined' && result['isValid']() ) { // send if valid
                    // Experimental - inheritedData
                    // Inhertitance from previously posted form: merging datas with current form context
                    // TODO - Get the inhereted data from LMDB Database using the form CSRF
                    var inheritedData = instance.$forms[_id].target.getAttribute('data-gina-form-inherits-data') || null;
                    if (inheritedData) {
                        result['data'] = merge(result['data'],  JSON.parse(decodeURIComponent(inheritedData)) )
                    }
                    // now sending to server
                    if (instance.$forms[_id]) {
                        instance.$forms[_id].send(result['data']);
                    } else if ($form) { // just in case the form is being destroyed
                        $form.send(result['data']);
                    }
                }
            })
        }
        // cannot be binded twice
        if ( typeof(gina.events[evt]) != 'undefined' && gina.events[evt] == 'validate.' + _id ) {
            removeListener(gina, $form, evt, proceed)
        }

        proceed();

        var proceedToSubmit = function (evt, $submit) {
            // attach submit events
            if ( !/^submit\./i.test(evt) ) {
                evt = 'submit.'+ evt;
            }
            //console.debug('attaching submit event: `'+  evt +'` on `'+ $submit.id + '` element for form `'+ $submit.form.id +'`');
            addListener(gina, $submit, evt, function(event) {
                // start validation
                cancelEvent(event);

                // getting fields & values
                var $fields         = {}
                    , fields        = { '_length': 0 }
                    , id            = $target.getAttribute('id')
                    , rules         = ( typeof(instance.$forms[id]) != 'undefined' ) ? instance.$forms[id].rules : null
                    , name          = null
                    , value         = 0
                    , type          = null
                    , index         = { checkbox: 0, radio: 0 }
                    , isDisabled    = null
                ;

                // stop there if form has already been sent
                if (instance.$forms[id].sent) {
                    return;
                }

                var validatorInfos = getFormValidationInfos($target, rules);
                fields  = validatorInfos.fields;
                $fields = validatorInfos.$fields;
                rules   = instance.$forms[id].rules;


                if ( fields['_length'] == 0 ) { // nothing to validate
                    delete fields['_length'];
                    var result = {
                        'error'     : [],
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
                        rule = getRuleObjByName(customRule.replace(/\-|\//g, '.'))
                    } else {
                        rule = getRuleObjByName(_id.replace(/\-/g, '.'))
                    }
                    instance.$forms[id].isSubmitting = true;
                    instance.$forms[id].isSending = false;
                    validate($target, fields, $fields, rule, function onClickValidation(result){
                        triggerEvent(gina, $target, 'validate.' + _id, result)
                    })
                }
            });
        }


        // BO binding submit button
        var $submit         = null
            , $buttons      = []
            , $buttonsTMP   = []
            , linkId        = null
            , buttonId      = null
        ;
        $buttonsTMP = $target.getElementsByTagName('button');
        if ( $buttonsTMP.length > 0 ) {
            for(let b = 0, len = $buttonsTMP.length; b < len; ++b) {
                if ($buttonsTMP[b].type == 'submit') {
                    $buttons.push($buttonsTMP[b])
                }
            }
        }

        // binding links
        $buttonsTMP = $target.getElementsByTagName('a');
        if ( $buttonsTMP.length > 0 ) {
            for(let b = 0, len = $buttonsTMP.length; b < len; ++b) {
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

        //
        var onclickAttribute = null, isSubmitType = false;
        for (let b=0, len=$buttons.length; b<len; ++b) {

            $submit = $buttons[b];
            // retrieve submitTrigger
            if (
                /button/i.test($submit.tagName)
                && typeof($submit.type) != 'undefined'
                && /submit/i.test($submit.type)
                ||
                /a/i.test($submit.tagName)
                && typeof($submit.dataset.ginaFormSubmit) != 'undefined'
                && /^true$/i.test($submit.dataset.ginaFormSubmit)
                ||
                /a/i.test($submit.parentNode.tagName)
                && typeof($submit.parentNode.dataset.ginaFormSubmit) != 'undefined'
                && /^true$/i.test($submit.parentNode.dataset.ginaFormSubmit)
            ) {
                if ( /a/i.test($submit.parentNode.tagName) ) {
                    $submit = $submit.parentNode;
                }

                if ( typeof($submit.id) == 'undefined' || typeof($submit.id) != 'undefined' && $submit.id == "" ) {
                    $submit.id = 'click.'+uuid.v4();
                    $submit.setAttribute('id', $submit.id);
                }

                if ( /a/i.test($submit.tagName) && typeof($submit.form) == 'undefined' ) {
                    $submit.form = { id: $form.id };
                }

                /**if ( typeof(instance.$forms[$form.id].submitTrigger) != 'undefined' &&  $submit.form.id !== instance.$forms[$form.id].submitTrigger ) {
                    console.warn('Form `submitTrigger` is already defined for your form #'+ $submit.form.id +': cannot attach `'+$submit.id+'`');
                } else */
                if (
                    typeof($submit.dataset.ginaFormSubmitTriggerFor) == 'undefined'
                    && typeof(instance.$forms[$form.id]) != 'undefined'
                    && typeof(instance.$forms[$form.id].submitTrigger) == 'undefined'
                    && typeof($submit.form.id) != 'undefined'
                    && $form.id == $submit.form.id
                ) {
                    console.debug('attching submitTrigger: '+ $submit.id, ' \ form id: '+ $form.id);
                    instance.$forms[$form.id].submitTrigger = $form.submitTrigger = $submit.id || $submit.getAttribute('id');
                    // mark submitTrigger
                    $submit.dataset.ginaFormSubmitTriggerFor = $form.id;
                } // else, skipping
            }

            if ($submit.tagName == 'A') { // without this test, XHR callback is ignored
                //console.debug('a#$buttons ', $buttonsTMP[b]);
                onclickAttribute    = $submit.getAttribute('onclick');
                isSubmitType        = $submit.getAttribute('data-gina-form-submit');

                if ( !onclickAttribute && !isSubmitType) {
                    $submit.setAttribute('onclick', 'return false;')
                } else if ( !/return false/i.test(onclickAttribute) && !isSubmitType) {
                    if ( /\;$/.test(onclickAttribute) ) {
                        onclickAttribute += 'return false;'
                    } else {
                        onclickAttribute += '; return false;'
                    }
                }
            }

            if (!$submit['id']) {
                evt             = 'click.'+ uuid.v4();
                $submit['id']   = evt;
                $submit.setAttribute( 'id', evt);
            } else {
                evt = $submit['id'];
            }

            if ( typeof(gina.events[evt]) == 'undefined' || gina.events[evt] != $submit.id ) {
                proceedToSubmit(evt, $submit)
            }

        }// BO binding submit button

        evt = 'submit';

        // submit proxy
        addListener(gina, $target, evt, function(e) {

            var $target             = e.target
                , id                = $target.getAttribute('id')
                , $formInstance     = instance.$forms[id]
                , isBinded          = $form.binded
            ;

            // check submit trigger status
            var submitTrigger = new DOMParser()
                .parseFromString($target.innerHTML, 'text/html')
                .getElementById($formInstance.submitTrigger);
            // prevent submit if disabled
            if ( submitTrigger && submitTrigger.disabled) {
                cancelEvent(e);
            }

            // prevent event to be triggered twice
            if ( typeof(e.defaultPrevented) != 'undefined' && e.defaultPrevented )
                return false;

            if (withRules || isBinded) {
                cancelEvent(e);
            }


            // just collect data over forms
            // getting fields & values
            var $fields         = {}
                , fields        = { '_length': 0 }
                , rules         = ( typeof(gina.validator.$forms[id]) != 'undefined' ) ? gina.validator.$forms[id].rules : null
                , name          = null
                , value         = 0
                , type          = null
                , index         = { checkbox: 0, radio: 0 }
                , isDisabled    = null
            ;


            for (var i = 0, len = $target.length; i<len; ++i) {

                name        = $target[i].getAttribute('name');
                // NB.: If you still want to save the info and you main field is disabled;
                //      consider using an input type=hidden of validator rule `"exclude" : false`
                isDisabled  = $target[i].disabled || $target[i].getAttribute('disabled');
                isDisabled  = ( /disabled|true/i.test(isDisabled) ) ? true : false;

                if (!name) continue;
                if (isDisabled) continue;

                // checkbox or radio
                if ( typeof($target[i].type) != 'undefined' && $target[i].type == 'radio' || typeof($target[i].type) != 'undefined' && $target[i].type == 'checkbox' ) {

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

                //++fields['_length']
            }
            fields['_length'] = fields.count();


            if ( fields['_length'] == 0 ) { // nothing to validate

                delete fields['_length'];
                var result = {
                    'error'     : [],
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
                    rule = getRuleObjByName(customRule.replace(/\-|\//g, '.'))
                } else {
                    rule = getRuleObjByName(id.replace(/\-/g, '.'))
                }
                instance.$forms[id].isValidating = true;
                validate($target, fields, $fields, rule, function onSubmitValidation(result){
                    instance.$forms[id].isValidating = false;
                    // var isFormValid = result.isValid();
                    // if (isFormValid) {
                    //     //resetting error display
                    //     handleErrorsDisplay($target, {}, result.data);
                    // } else {
                        // handleErrorsDisplay($target, result.error, result.data);
                        if ( typeof(gina.events['submit.' + id]) != 'undefined' ) { // if `on('submit', cb)` is binded
                            triggerEvent(gina, $target, 'submit.' + id, result);
                        } else {
                            triggerEvent(gina, $target, 'validate.' + id, result);
                        }
                        return;
                    // }
                })
            }
        });



        instance.$forms[_id]['binded']  = true;
        // If Live check enabled, proceed to silent validation
        if ( /^(true)$/i.test($form.target.dataset.ginaFormLiveCheckEnabled && $form.rules.count() > 0) ) {
            console.debug('silent validation mode on');
            var validationInfo  = getFormValidationInfos($form.target, $form.rules);
            var fields          = validationInfo.fields;
            var $fields         = validationInfo.$fields;
            validate($form.target, fields, $fields, $form.rules, function onSilentValidation(result){
                console.debug('silent validation result[isValid:'+result.isValid()+']: ', result);
                if ( envIsDev && isGFFCtx && typeof(window.ginaToolbar) != 'undefined' && window.ginaToolbar ) {
                    // update toolbar
                    if (!gina.forms.errors)
                        gina.forms.errors = {};

                    var objCallback = {
                        id      : _id,
                        errors  :  result.error //,
                        // we might also need to update rules in case of form ajax changes
                        // rules   : $form.rules,
                        // data    : result.data
                    };

                    window.ginaToolbar.update('forms', objCallback);
                }
                updateSubmitTriggerState( $form, result.isValid() );
            });
        } else if (!/^(true)$/i.test($form.target.dataset.ginaFormLiveCheckEnabled) ) {
            updateSubmitTriggerState( $form , true );
        }

    } // EO bindForm()

    var updateSubmitTriggerState = function($formInstanceOrTarget, isFormValid) {
        //console.debug('submitTrigger[isFormValid='+ isFormValid +']: ', $formInstance.submitTrigger)
        $formInstance = null;
        if ( $formInstanceOrTarget instanceof HTMLFormElement ) { //  is target DOMobject
            var id = $formInstanceOrTarget.getAttribute('id');
            $formInstance =  instance.$forms[id];
        } else {
            $formInstance = $formInstanceOrTarget;
        }
        //if (!$formInstance) return;

        if ( typeof($formInstance.submitTrigger) == 'undefined') {
            console.warn('This might be normal, so do not worry if this form is handled by your javascript: `'+ $formInstance.id +'`\nGina could not complete `updateSubmitTriggerState()`: `submitTrigger` might not be attached to form instance `'+ $formInstance.id +'`\nTo disable this warning, You just need to disable `Form Live Checking on your form by adding to your <form>: `data-gina-form-live-check-enabled=false``')
        } else if ( document.getElementById($formInstance.submitTrigger) ) {
            if ( /true/i.test(isFormValid) ) { // show submitTrigge
                document.getElementById($formInstance.submitTrigger).disabled = false;
            } else { // hide submitTrigger
                document.getElementById($formInstance.submitTrigger).disabled = true;
            }
        }
    }

    /**
     * getFormValidationInfos
     *
     * @param {object} $form - form target (DOMObject), not the instance
     * @param {object} [rules]
     *
     * @returns {object} { .fields, .$fields, .rules }
     */
    var getFormValidationInfos = function($form, rules, isOnResetMode) {
        // patching form reset
        if (typeof(isOnResetMode) == 'undefined') {
            isOnResetMode = false;
        }
        // getting fields & values
        var $fields         = {}
            , fields        = {}//{ '_length': 0 }
            , id            = $form.id || $form.getAttribute('id')
            , name          = null
            , value         = 0
            , type          = null
            , index         = { checkbox: 0, radio: 0 }
            , isDisabled    = null
        ;
        if ( typeof(rules) == 'undefined' ) {
            rules = ( typeof(instance.$forms[id].rules) != 'undefined' && instance.$forms[id].rules.count() > 0 ) ? instance.$forms[id].rules : null;
            if (!rules && typeof(gina.validator.$forms[id]) != 'undefined') {
                rules = gina.validator.$forms[id].rules
            }
        }

        // BO Parsing form elements
        for (var i = 0, len = $form.length; i<len; ++i) {
            if ( isOnResetMode ) {
                // reset form values
                switch ($form[i].tagName.toLowerCase()) {
                    case 'input':
                        if ( /^(hidden|text)$/i.test($form[i].type) ) {
                            $form[i].value = $form[i].defaultValue;
                        }
                        break;

                    default:
                        break;
                }
            }

            // retrieve submitTrigger
            if (
                /button/i.test($form[i].tagName)
                && typeof($form[i].type) != 'undefined'
                && /submit/i.test($form[i].type)
                ||
                /a/i.test($form[i].tagName)
                && typeof($form[i].dataset.ginaFormSubmit) != 'undefined'
                && /^true$/i.test($form[i].dataset.ginaFormSubmit)
            ) {
                if ( /a/i.test($form[i].tagName) && typeof($form[i].form) == 'undefined' ) {
                    $form[i].form = { id: id };
                }
                /**if ( typeof(instance.$forms[id].submitTrigger) != 'undefined' &&  $form[i].form.id !== instance.$forms[id].submitTrigger ) {
                    console.warn('Form `submitTrigger` is already defined for your form `#'+ $form[i].form.id +'`: cannot attach `'+$form[i].id+'`');
                } else */
                if (
                    typeof($form[i].dataset.ginaFormSubmitTriggerFor) == 'undefined'
                    && typeof(instance.$forms[id]) != 'undefined'
                    && typeof(instance.$forms[id].submitTrigger) == 'undefined'
                    && typeof($form[i].form.id) != 'undefined'
                    && id == $form[i].form.id
                ) {
                    instance.$forms[id].submitTrigger = $form[i].id || $form[i].getAttribute('id');
                    // mark submitTrigger
                    $form[i].dataset.ginaFormSubmitTriggerFor = id;
                }
                // else, skipping
            }

            name        = $form[i].getAttribute('name');
            // NB.: If you still want to save the info and you main field is disabled;
            //      consider using an input type=hidden of validator rule `"exclude" : false`
            isDisabled  = $form[i].disabled || $form[i].getAttribute('disabled');
            isDisabled  = ( /disabled|true/i.test(isDisabled) ) ? true : false;

            if (!name) continue;
            if (isDisabled) continue;

            // TODO - add switch cases against tagName (checkbox/radio)
            if (
                typeof($form[i].type) != 'undefined'
                && $form[i].type == 'radio'
                ||
                typeof($form[i].type) != 'undefined'
                && $form[i].type == 'checkbox' )
             {

                if (
                    $form[i].checked
                    || typeof (rules[name]) == 'undefined'
                        && $form[i].value != 'undefined'
                        && /^(true|false)$/.test($form[i].value)
                    || !$form[i].checked
                        && typeof (rules[name]) != 'undefined'
                        //&& typeof (rules[name].isBoolean) != 'undefined' && /^true$/.test(rules[name].isBoolean)
                        //&& typeof (rules[name].isRequired) != 'undefined' && /^true$/.test(rules[name].isRequired)
                        && typeof (rules[name].isBoolean) != 'undefined'
                        && /^(true|false)$/.test($form[i].value)
                ) {
                    // if is boolean
                    if ( /^(true|false)$/.test($form[i].value) ) {

                        if ( typeof(rules[name]) == 'undefined' ) {
                            rules[name] = { isBoolean: true };
                        } else if ( typeof(rules[name]) != 'undefined' && typeof(rules[name].isBoolean) == 'undefined' ) {
                            rules[name].isBoolean = true;
                            // forces it when field found in validation rules
                            rules[name].isRequired = true;
                        }

                        if ($form[i].type == 'radio') {
                            if ( typeof(rules[name]) == 'undefined' )
                                throw new Error('rule '+ name +' is not defined');

                            if (/^true$/.test(rules[name].isBoolean) && $form[i].checked ) {
                                fields[name] = (/^true$/.test($form[i].value)) ? true : false;
                            }
                        } else {
                            fields[name] = $form[i].value = (/^true$/.test($form[i].value)) ? true : false;
                        }

                    } else {
                        fields[name] = $form[i].value
                    }

                }  else if ( // force validator to pass `false` if boolean is required explicitly
                    rules
                    && typeof(rules[name]) != 'undefined'
                    && typeof(rules[name].isBoolean) != 'undefined'
                    && typeof(rules[name].isRequired) != 'undefined'
                    && !/^(true|false)$/.test($form[i].value)

                ) {
                    fields[name] = false;
                }

            } else {
                fields[name] = $form[i].value;
            }

            if ( typeof($fields[name]) == 'undefined' ) {
                $fields[name] = $form[i];
                // reset filed error data attributes
                $fields[name].setAttribute('data-gina-form-errors', '');
            }

            //++fields['_length']
        }// EO Parsing form elements
        fields['_length'] = fields.count() || 0;

        return {
            '$fields'   : $fields,
            'fields'    : fields,
            'rules'     : rules
        }
    }

    var getCastedValue = function(ruleObj, fields, fieldName, isOnDynamisedRulesMode) {

        if (
            // do not cast if no rule linked to the field
            typeof(ruleObj[fieldName]) == 'undefined'
            // do not cast if not defined or on error
            || /^(null|NaN|undefined|\s*)$/i.test(fields[fieldName])
        ) {
            return fields[fieldName]
        }

        if (
            /**typeof(ruleObj[fieldName].isBoolean) != 'undefined'
            || */typeof(ruleObj[fieldName].isNumber) != 'undefined'
            || typeof(ruleObj[fieldName].isInteger) != 'undefined'
            || typeof(ruleObj[fieldName].isFloat) != 'undefined'
            || typeof(ruleObj[fieldName].toFloat) != 'undefined'
            || typeof(ruleObj[fieldName].toInteger) != 'undefined'
        ) {

            if ( /\,/.test(fields[fieldName]) ) {
                fields[fieldName] = fields[fieldName].replace(/\,/g, '.').replace(/\s+/g, '');
            }
            return fields[fieldName];
        }

        if ( typeof(fields[fieldName]) == 'boolean') {
            return fields[fieldName]
        } else if (ruleObj[fieldName].isBoolean) {
            return (/^true$/i.test(fields[fieldName])) ? true : false;
        }

        return (
            typeof(isOnDynamisedRulesMode) != 'undefined'
            && /^true$/i.test(isOnDynamisedRulesMode)
        ) ? '\\"'+ fields[fieldName] +'\\"' : fields[fieldName];
    }

    /**
     * formatFields
     * Will cast values if needed
     *
     * @param {string|object} rules
     * @param {object} fields
     * @returns
     */
    var formatFields = function(rules, fields) {
        var ruleObj = null;
        if ( typeof(rules) != 'string') {
            rules = JSON.stringify(JSON.clone(rules))
        }
        ruleObj = JSON.parse(rules.replace(/\"(true|false)\"/gi, '$1'));

        for (let fName in fields) {
            fields[fName] = getCastedValue(ruleObj, fields, fName);
        }
        return fields;
    }

    var getDynamisedRules = function(stringifiedRules, fields, $fields, isLiveCheckingOnASingleElement) {

        // Because this could also be live check, if it is the case, we need all fields
        // of the current form rule for variables replacement/evaluation. Since live check is
        // meant to validate one field at the time, you could fall in a case where the current
        // field should be compared with another field of the same form.
        var ruleObj = JSON.parse(stringifiedRules.replace(/\"(true|false)\"/gi, '$1'));
        var stringifiedRulesTmp = JSON.stringify(ruleObj);
        if (isLiveCheckingOnASingleElement) {
            var $currentForm    = $fields[Object.getOwnPropertyNames($fields)[0]].form;
            var vInfos          = getFormValidationInfos($currentForm, ruleObj);
            delete vInfos.fields._length;

            fields  = vInfos.fields;
            $fields = vInfos.$fields;
        }


        var re = null, _field = null, arrFields = [], a = 0;
        // avoiding conflict like ["myfield", "myfield-name"]
        // where once `myfield` is replaced for exemple with `1234`, you also get 1234-name left behind
        // TODO - Replace this trick with a RegExp matching only the exact word
        // TODO - test this one:
        //          \W(\$myfield-name)(?!-)\W
        for (let field in fields) {
            arrFields[a] = field;
            a++;
        }
        arrFields.sort().reverse();

        for (let i = 0, len = arrFields.length; i < len; i++) {
            _field = arrFields[i].replace(/\-|\_|\@|\#|\.|\[|\]/g, '\\$&');
            re = new RegExp('\\$'+_field, 'g');
            // default field value
            let fieldValue = '\\"'+ fields[arrFields[i]] +'\\"';
            let isInRule = re.test(stringifiedRulesTmp);
            if ( isInRule && typeof(ruleObj[arrFields[i]]) != 'undefined' ) {
                fieldValue = getCastedValue(ruleObj, fields, arrFields[i], true);
            } else if ( isInRule ) {
                console.warn('`'+arrFields[i]+'` is used in a dynamic rule without definition. This could lead to an evaluation error. Casting `'+arrFields[i]+'` to `string`.');
            }

            stringifiedRules = stringifiedRules.replace(re, fieldValue );
        }
        if ( /\$(.*)/.test(stringifiedRules) ) {
            for (let i = 0, len = arrFields.length; i < len; i++) {
                _field = arrFields[i].replace(/\-|\_|\@|\#|\.|\[|\]/g, '\\$&');
                re = new RegExp('\\$'+_field, 'g');
                // default field value
                let fieldValue = ($fields[arrFields[i]].value != '' ) ? '\\"'+ $fields[arrFields[i]].value +'\\"' : '\\"\\"';
                let isInRule = re.test(stringifiedRulesTmp);
                if ( isInRule && typeof(ruleObj[arrFields[i]]) != 'undefined' ) {
                    fieldValue = getCastedValue(ruleObj, fields, arrFields[i], true);
                } else if ( isInRule ) {
                    console.warn('`'+arrFields[i]+'` is used in a dynamic rule without definition. This could lead to an evaluation error. Casting `'+arrFields[i]+'` to `string`.');
                }

                stringifiedRules = stringifiedRules.replace(re, fieldValue || $fields[arrFields[i]].checked);
            }
        }

        return JSON.parse(stringifiedRules)
    }


    /**
     * Validate form
     * @param {object} $formOrElement - ${form|element}.target (DOMObject)
     * @param {object} fields
     * @param {object} $fields
     * @param {object} rules
     * @param {callback} cb
     */
    var validate = function($formOrElement, fields, $fields, rules, cb) {

        delete fields['_length']; //cleaning

        var stringifiedRules = JSON.stringify(rules);
        fields = formatFields(stringifiedRules, fields);
        if ( /\$(.*)/.test(stringifiedRules) ) {
            var isLiveCheckingOnASingleElement = (
                !/^form$/i.test($formOrElement.tagName)
                && $fields.count() == 1
                && /true/i.test($formOrElement.form.dataset.ginaFormLiveCheckEnabled)
            ) ? true : false;
            rules = getDynamisedRules(stringifiedRules, fields, $fields, isLiveCheckingOnASingleElement)
        }
        var id                  = null
            , evt               = null
            , data              = null
            , hasBeenValidated  = false
            , subLevelRules     = 0
            , rootFieldsCount   = fields.count()
            , hasParsedAllRules = false
            , $asyncField       = null
            , $asyncFieldId     = null
            , asyncEvt          = null
            , asyncCount        = 0
        ;


        var re = null, flags = null, args = null;
        var checkFieldAgainstRules = function(field, rules, fields) {
            // ignore field if used as a _case_field

            // looking for regexp aliases from rules
            if ( typeof (rules[field]) == 'undefined') {
                skipTest = false;
                // TODO - replace loop by checkForRuleAlias(rules, $el);
                for (var _r in rules) {
                    if (/^_comment$/i.test(_r)) continue;
                    if ( /^\//.test(_r) ) { // RegExp found
                        re      = _r.match(/\/(.*)\//).pop();
                        flags   = _r.replace('/'+ re +'/', '');
                        // fix escaping "[" & "]"
                        re      = re.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
                        re      = new RegExp(re, flags);
                        if ( re.test(field)  ) {
                            skipTest = true;
                            // create new entry
                            rules[field] = rules[_r];
                            break;
                        }
                    }
                }

                if ( typeof(rules[field]) == 'undefined' )
                    return;
            }

            var listedFields = Object.getOwnPropertyNames(rules) || [];
            var f = 0, fLen = listedFields.length;
            if (fLen > 0) {
                while (f < fLen) {
                    if (
                        typeof(rules[listedFields[f]].exclude) != 'undefined'
                        && /^true$/i.test(rules[listedFields[f]].exclude)
                    ) {
                        // remove from listedFields
                        listedFields.splice(f, 1);
                        fLen--;
                        f--;
                    }
                    f++;
                }
            }

            // check each field against rule
            for (var rule in rules[field]) {
                // skip when not processing rule function
                if ( typeof(d[field][rule]) != 'function' ) {
                    continue;
                }

                if ( /^((is)\d+|is$)/.test(rule) && typeof(d[field][rule]) == 'undefined' ) { // is aliases
                    d[field][rule] = function(){};
                    d[field][rule] = inherits(d[field][rule], d[field][ rule.replace(/\d+/, '') ]);
                    d[field][rule].setAlias = (function(alias) {
                        this._currentValidatorAlias = alias
                    }(rule));
                }
                // check for rule params
                try {
                    if (Array.isArray(rules[field][rule])) { // has args
                        //convert array to arguments
                        args = JSON.clone(rules[field][rule]);
                        if ( /\$[\-\w\[\]]*/.test(args[0]) ) {
                            var foundVariables = args[0].match(/\$[\-\w\[\]]*/g);
                            for (var v = 0, vLen = foundVariables.length; v < vLen; ++v) {
                                args[0] = args[0].replace( foundVariables[v], d[foundVariables[v].replace('$', '')].value )
                            }
                        }
                        d[field][rule].apply(d[field], args);
                    } else {
                        // query rule case
                        if ( /^query$/.test(rule) ) {
                            $asyncField     = $fields[field];
                            $asyncFieldId   = $asyncField.getAttribute('id');
                            asyncEvt        = 'asyncCompleted.'+ $asyncFieldId;

                            var triggeredCount = 0, eventTriggered = false;
                            if ( typeof(gina.events[asyncEvt]) != 'undefined' ) {
                                console.debug('event `'+ asyncEvt +'` already added');
                                asyncCount = 0;
                                return;
                            }
                            ++asyncCount;
                            //console.debug('Adding listner '+asyncEvt);
                            addListener(gina, $asyncField, asyncEvt, function onasyncCompleted(event) {
                                event.preventDefault();

                                triggeredCount++;
                                --asyncCount;
                                // is this the last rule ?
                                var _rulesArr = Object.getOwnPropertyNames(rules[field]);
                                if (_rulesArr[_rulesArr.length-1] == rule) {
                                    hasParsedAllRules = true;
                                }

                                var _asyncEvt = 'asyncCompleted.' + event.target.getAttribute('id');
                                if ( /true/.test(eventTriggered) ) {
                                    // console.debug('already triggered !\nasyncCount: '+ asyncCount +'\nhasParsedAllRules: '+hasParsedAllRules );
                                    return;
                                }

                                d[field] = event.detail;

                                // retrieve current form
                                var $currentForm = $formOrElement;
                                if ( !/^form$/i.test($formOrElement.tagName) ) {
                                    $currentForm  = $formOrElement.form;
                                }
                                var formId = $currentForm.getAttribute('id');

                                if (
                                    hasParsedAllRules
                                    && asyncCount <= 0
                                    && !eventTriggered
                                ) {
                                    eventTriggered = true;

                                    // removing listner to revalidate with another context
                                    //console.debug('removing listner '+ _asyncEvt +'\nasyncCount: '+ asyncCount +'\nhasParsedAllRules: '+hasParsedAllRules + '\neventTriggered: '+ eventTriggered);
                                    removeListener(gina, event.target, _asyncEvt);

                                    cb._data = d['toData']();
                                    cb._errors = d['getErrors'](field);
                                    // console.debug('query callbakc triggered ', cb._errors, '\nisValidating: ', instance.$forms[formId].isValidating);
                                    // update instance form errors
                                    if ( cb._errors && cb._errors.count() > 0) {
                                        if ( typeof(instance.$forms[formId].errors) == 'undefined' ) {
                                            instance.$forms[formId].errors = {}
                                        }

                                        instance.$forms[formId].errors[field] = cb._errors[field];

                                        if (!isFormValid && /^true|false$/i.test(instance.$forms[formId].isValidating) || d[field].target.value != '' ) {
                                            refreshWarning($allFields[field]);
                                            handleErrorsDisplay($currentForm, cb._errors, cb._data, field);
                                            updateSubmitTriggerState( $currentForm, isFormValid);
                                        }

                                        if ( envIsDev && isGFFCtx && typeof(window.ginaToolbar) != 'undefined' && window.ginaToolbar ) {
                                            // update toolbar
                                            if (!gina.forms.errors)
                                                gina.forms.errors = {};

                                            var objCallback = {
                                                id      : formId,
                                                errors  :  instance.$forms[formId].errors || {}
                                            };

                                            window.ginaToolbar.update('forms', objCallback);
                                        }


                                        triggerEvent(gina, $currentForm, 'validated.' + formId, cb);
                                        return;
                                    }
                                }

                                // is this the last or the only field to be validated ?
                                var needsGlobalReValidation = false, isFormValid = null;
                                if ( listedFields.length == 1 || listedFields[listedFields.length-1] == field) {
                                    // trigger end of validation
                                    // console.debug(field +' is the last element to be validated for formId: '+ formId, cb._errors, instance.$forms[formId].errors);
                                    isFormValid = ( cb._errors.count() > 0 ) ? false : true;
                                    if (!isFormValid && /^true|false$/i.test(instance.$forms[formId].isValidating)) {
                                        //console.debug('should update error display now ', cb._errors);
                                        instance.$forms[formId].errors = merge(cb._errors, instance.$forms[formId].errors);
                                        refreshWarning($allFields[field]);
                                        handleErrorsDisplay($currentForm, cb._errors, cb._data, field);
                                        updateSubmitTriggerState( $currentForm, isFormValid);
                                    }
                                    triggerEvent(gina, $currentForm, 'validated.' + formId, cb);
                                }
                                // just update warning state
                                else if (/^true$/i.test(instance.$forms[formId].isValidating) && listedFields.length > 1 && listedFields[listedFields.length-1] != field ) {
                                    //console.debug(field +' is NOT the last element to be validated for formId: '+ formId);
                                    needsGlobalReValidation = true;
                                }

                                if (needsGlobalReValidation) {
                                    validate($currentForm, allFields, $allFields, rules, function onSilentQueryGlobalLiveValidation(gResult){
                                        instance.$forms[formId].isValidating = false;
                                        // console.debug('['+ formId +'] onSilentQueryGlobalLiveValidation: '+ gResult.isValid(), gResult);
                                        isFormValid = gResult.isValid();
                                        if ( envIsDev && isGFFCtx && typeof(window.ginaToolbar) != 'undefined' && window.ginaToolbar ) {
                                            // update toolbar
                                            if (!gina.forms.errors)
                                                gina.forms.errors = {};

                                            var objCallback = {
                                                id      : formId,
                                                errors  :  gResult.error || {}
                                            };

                                            window.ginaToolbar.update('forms', objCallback);
                                        }



                                        handleErrorsDisplay($currentForm, gResult.error, gResult.data, field);
                                        updateSubmitTriggerState( $currentForm, isFormValid);
                                    })
                                }

                            });

                            d[field][rule](rules[field][rule]);
                            continue;
                        }
                        // normal rule case
                        else {
                            d[field][rule](rules[field][rule]);
                        }
                    }

                    delete fields[field];

                } catch (err) {
                    if (rule == 'conditions') {
                        throw new Error('[ ginaFormValidator ] could not evaluate `' + field + '->' + rule + '()` where `conditions` must be a `collection` (Array)\nStack:\n' + err)
                    } else {
                        throw new Error('[ ginaFormValidator ] could not evaluate `' + field + '->' + rule + '()`\nStack:\n' + err)
                    }
                }
            }
        }


        //console.debug(fields, $fields);
        var d = null;//FormValidator instance
        var fieldErrorsAttributes = {}, isSingleElement = false;
        if (isGFFCtx) { // Live check if frontend only for now
            // form case
            if ( /^form$/i.test($formOrElement.tagName) ) {
                id = $formOrElement.getAttribute('id');
                evt = 'validated.' + id;
                instance.$forms[id].fields = fields;
                // clear existing errors
                if ( typeof($formOrElement.eventData) != 'undefined' && typeof($formOrElement.eventData.error) != 'undefined' ) {
                    delete $formOrElement.eventData.error
                }
                d = new FormValidator(fields, $fields, xhrOptions);
            }
            // single element case
            else {
                isSingleElement = true;
                id = $formOrElement.form.getAttribute('id') || $formOrElement.form.target.getAttribute('id');

                evt = 'validated.' + id;
                instance.$forms[id].fields = fields;
                d = new FormValidator(fields, $fields, xhrOptions, instance.$forms[id].fieldsSet);
            }
        } else {
            d = new FormValidator(fields, null, xhrOptions);
        }


        var allFields = null;
        var $allFields = null;
        if (!isSingleElement) {
            allFields   = JSON.clone(fields);
            $allFields  = $fields;
        } else {
            // TODO - Get cached infos
            var formId = $formOrElement.form.getAttribute('id');
            var formAllInfos = getFormValidationInfos(instance.$forms[formId].target, instance.$forms[formId].rules, false);
            allFields   = formatFields(JSON.stringify(instance.$forms[formId].rules), JSON.clone(formAllInfos.fields));
            $allFields  = formAllInfos.$fields;
        }

        var allRules = ( typeof(rules) !=  'undefined' ) ? JSON.clone(rules) : {};
        var forEachField = function($formOrElement, allFields, allRules, fields, $fields, rules, cb, i) {


            var hasCase = false, isInCase = null, conditions = null;
            var caseValue = null, caseType = null;
            var localRules = null, caseName = null;
            var localRuleObj = null, skipTest = null;

            //console.debug('parsing ', fields, $fields, rules);
            if ( typeof(rules) != 'undefined' ) {

                for (var field in fields) {

                    if ( isGFFCtx && typeof($fields[field]) == 'undefined' ) {
                        //throw new Error('field `'+ field +'` found for your form rule ('+ $formOrElement.id +'), but not found in $field collection.\nPlease, check your HTML or remove `'+ field +'` declaration from your rule.')
                        console.warn('field `'+ field +'` found for your form rule ('+ $formOrElement.id +'), but not found in $field collection.\nPlease, check your HTML or remove `'+ field +'` declaration from your rule if this is a mistake.');
                        continue;
                    }
                    // 2021-01-17: fixing exclude default override for `data-gina-form-element-group`
                    if (
                        isGFFCtx
                        && $fields[field].getAttribute('data-gina-form-element-group')
                        && typeof(rules[field]) != 'undefined'
                        && typeof(rules[field].exclude) != 'undefined'
                        && rules[field].exclude
                        && !$fields[field].disabled
                    ) {
                        rules[field].exclude = false;
                    }

                    hasCase = ( typeof(rules['_case_' + field]) != 'undefined' ) ? true : false;
                    isInCase = false;


                    if (
                        isGFFCtx
                        && $fields[field].tagName.toLowerCase() == 'input'
                        && /(checkbox)/i.test($fields[field].getAttribute('type'))
                    ) {
                        if (
                            !$fields[field].checked
                                && typeof(rules[field]) != 'undefined'
                                && typeof(rules[field].isRequired) != 'undefined'
                                && /^(false)$/i.test(rules[field].isRequired)
                            ||
                            $fields[field].disabled
                        ) {
                            rules[field] = {
                                exclude: true
                            }

                        } else if ( !$fields[field].checked && typeof(rules[field]) == 'undefined' ) {
                            continue;
                        }
                    }




                    for (var c in rules) {
                        if (!/^\_case\_/.test(c) ) continue;
                        if ( typeof(rules[c].conditions) == 'undefined' || Array.isArray(rules[c].conditions) && !rules[c].conditions.length ) continue;
                        if ( typeof(rules[c].conditions[0].rules) == 'undefined' ) continue;


                        // enter cases conditions
                        if (
                            typeof(rules[c].conditions) != 'undefined'
                            && Array.isArray(rules[c].conditions)
                        ) {
                            caseName = c.replace('_case_', '');
                            // if case exists but case field not existing
                            if ( typeof($allFields[caseName]) == 'undefined' ) {
                                console.warn('Found case `'+ c +'` but field `'+ caseName +'` is misssing in the dom.\n You should add `'+ caseName +'` element to your form in order to allow Validator to process this case.');
                                continue
                            }

                            // depending on the case value, replace/merge original rule with condition rule
                            if ( typeof(allFields[caseName]) == 'undefined' ) {
                                //allFields[caseName] =  $fields[c.replace(/^\_case\_/, '')].value
                                allFields[caseName] =  $allFields[caseName].value
                            }
                            // Watch changes in case the value is modified
                            // A mutation observer was previously defined in case of hidden field when value has been mutated with javascript
                            // Ref.: liveCheck; look for comment `// Adding observer for hidden fileds`
                            /**
                            let caseEvent = 'change._case_' + caseName;
                            if ( typeof(gina.events[caseEvent]) == 'undefined' ) {

                                var redefineRulingContext = function($el, rules, c) {
                                    var _caseName = $el.name;
                                    if ( allFields[_caseName] != $el.value ) {
                                        console.debug('case `'+ _caseName +'` is changing from ', allFields[_caseName], ' to ', $el.value );

                                        if ( typeof(fields) == 'undefined') {
                                            var fields = {};
                                        }
                                        var _val = $el.value;
                                        if ( /^(true|false)$/i.test(_val) ) {
                                            _val = (/^(true)$/i.test(_val)) ? true : false;
                                        }
                                        if ( /^\d+$/.test(_val) ) {
                                            _val = parseInt(_val);
                                        }
                                        // Saving case current value
                                        allFields[_caseName] = fields[_caseName] = _val;

                                        // rebind & restart validation in silent mode
                                        var $_form = $el.form;
                                        if ($_form) {
                                            // backup `originalRules` in order to avoid override
                                            var formInstance = instance['$forms'][$_form.id];
                                            var customRules = {};
                                            var caseRules = {};
                                            var _conditions = [];
                                            if ( typeof(formInstance.originaRules) == 'undefined' ) {
                                                formInstance.originaRules = JSON.clone(rules);
                                            } else {
                                                //customRules = merge(rules, formInstance.originaRules);
                                                //customRules = JSON.clone(formInstance.originaRules);
                                                caseRules = JSON.clone(formInstance.originaRules);
                                            }
                                            //var customRules = JSON.clone(formInstance.originaRules);

                                            //var customRules = JSON.clone(rules);

                                            if ( typeof(rules[c]) != 'undefined' && typeof(rules[c].conditions) != 'undefined' ) {
                                                _conditions = rules[c].conditions;
                                            } else if (typeof(rules['_case_'+_caseName]) != 'undefined' && typeof(rules['_case_'+_caseName].conditions) != 'undefined') {
                                                _conditions = rules['_case_'+_caseName].conditions;
                                            }
                                            if (_conditions.length > 1) { // more than one condition
                                                for (let _ci = 0, _ciLen = _conditions.length; _ci < _ciLen; _ci++) {
                                                    if (
                                                        Array.isArray(_conditions[_ci].case)
                                                        && _conditions[_ci].case.indexOf(fields[_caseName]) > -1
                                                        ||
                                                        _conditions[_ci].case == fields[_caseName]
                                                    ) {
                                                        // Inherited first
                                                        caseRules = merge(_conditions[_ci].rules, caseRules);
                                                        //caseRules = _conditions[_ci].rules;
                                                    }
                                                }
                                            } else {
                                                if (
                                                    Array.isArray(_conditions[0].case)
                                                    && _conditions[0].case.indexOf(fields[_caseName]) > -1
                                                    ||
                                                    _conditions[0].case == fields[_caseName]
                                                ) {
                                                    // Inherited first
                                                    caseRules = merge(_conditions[0].rules, caseRules);
                                                    //caseRules = _conditions[0].rules;
                                                } else {
                                                    var _filter = {};
                                                    _filter['case'] = fields[_caseName];
                                                    try {
                                                        caseRules = merge(new Collection(_conditions).findOne(_filter).rules, caseRules)
                                                        //caseRules = new Collection(_conditions).findOne(_filter).rules
                                                        //caseRules = new Collection(_conditions).findOne(_filter).rules;
                                                    } catch (err) {
                                                        console.warn('Trying to eval undeclared or misconfigured case `"_case_'+ _caseName +'"`: `'+ fields[_caseName] +'`.\Now Skipping it, please check your rules and fix it if needed.');
                                                        // else -> caseRules = {}
                                                    }

                                                    _filter = null;
                                                }
                                            }
                                            _conditions = null;



                                            // Setting up new validation rules
                                            for (let _f in caseRules) {
                                                // if ( typeof(customRules[_f]) == 'undefined' ) {
                                                    customRules[_f] = caseRules[_f];
                                                // } else {
                                                //     // do not override customRules
                                                //     customRules[_f] = merge(customRules[_f], caseRules[_f]);
                                                // }

                                            }
                                            // formInstance._current_caseName = _caseName;
                                            // if ( typeof(formInstance._current_case) == 'undefined' ) {
                                            //     formInstance._current_case = {};
                                            // }
                                            // formInstance._current_case[_caseName] = customRules;

                                            caseRules = null;
                                            // reset binding
                                            reBindForm($_form, customRules);
                                        }
                                    }
                                }


                                //console.debug('placing event on ', $fields[caseName].name, caseEvent)
                                // We need to bind the case event and the input event at the same time
                                // search for grouped els
                                // var grpName = $fields[caseName].name;
                                // var selectedEls = [], sl = 0;
                                // if ( $formOrElement.length > 1 ) {
                                //     for (let g = 0, gLen = $formOrElement.length; g < gLen; g++) {
                                //         if (
                                //             $formOrElement[g].name ==  grpName
                                //             && $formOrElement[g].type == $fields[caseName].type
                                //             && $formOrElement[g].id != $fields[caseName].id
                                //         ) {
                                //             selectedEls[sl] = $formOrElement[g];
                                //             ++sl;
                                //         }
                                //     }
                                // }
                                // This portion of code is used for case value change
                                // var $elementToBind = (selectedEls.length > 0) ? selectedEls : $fields[caseName];
                                //     addListener(gina, $elementToBind, 'change.', function(event) {
                                //         event.preventDefault();
                                //         console.debug('Now rebinding on ', event.currentTarget.name +' == '+ event.currentTarget.value );
                                //         redefineRulingContext(event.currentTarget, rules, c);
                                //     });

                                // handles _case_* change; also useful if your are using radio tabs as cases triggers
                                addListener(gina, $fields[caseName], [ caseEvent, 'change.'+$fields[caseName].id ], function(event) {
                                    event.preventDefault();
                                    console.debug('First rebinding on ', event.currentTarget.name +' == '+ event.currentTarget.value );
                                    redefineRulingContext(event.currentTarget, rules, c);
                                });

                            } // EO caseEvent
                            */
                            caseValue = allFields[caseName];
                            if (isGFFCtx) {
                                if (fields[field] == "true")
                                    caseValue = true;
                                else if (fields[field] == "false")
                                    caseValue = false;
                            }


                            // filtering conditions
                            for (var _c = 0, _cLen = rules[c].conditions.length; _c < _cLen; ++_c) {

                                if (rules[c].conditions[_c].case != caseValue) {
                                    continue;
                                }

                                // enter condition rules
                                for (var _r in rules[c].conditions[_c].rules) {
                                    if (/^_comment$/i.test(_r)) continue;
                                    // ignore if we are testing on caseField or if $field does not exist
                                    if (_r == caseName || !$fields[_r]) continue;
                                    //if (_r == caseName || !$fields[caseName]) continue;
                                    // ok, not the current case but still,
                                    // we want to apply the validation when the field is not yet listed
                                    if (field != _r && !/^\//.test(_r) ) {
                                        if (
                                            typeof(fields[_r]) == 'undefined'
                                            &&  typeof(allFields[_r]) != 'undefined'
                                        ) {
                                            fields[_r] = allFields[_r];
                                            localRuleObj = ( typeof(rules[_r]) != 'undefined' ) ? rules[_r] : {};
                                            rules[_r] = merge(rules[c].conditions[_c].rules[_r], localRuleObj);

                                            checkFieldAgainstRules(_r, rules, fields);
                                            continue;
                                        }
                                    }


                                    if ( /^\//.test(_r) ) { // RegExp found
                                        re      = _r.match(/\/(.*)\//).pop();
                                        flags   = _r.replace('/'+ re +'/', '');
                                        // fix escaping "[" & "]"
                                        re      = re.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
                                        re      = new RegExp(re, flags);
                                        if ( re.test(field)  ) {
                                            // depending on the case value, replace/merge original rule with condition rule
                                            // if ( typeof(allFields[caseField]) == 'undefined' ) {
                                            //     allFields[caseField] =  $fields[c.replace(/^\_case\_/, '')].value
                                            // }
                                            // caseValue = allFields[caseField];
                                            // if (isGFFCtx) {
                                            //     if (fields[field] == "true")
                                            //         caseValue = true;
                                            //     else if (fields[field] == "false")
                                            //         caseValue = false;
                                            // }
                                            if (
                                                rules[c].conditions[_c].case == caseValue
                                                ||
                                                // test for regexp
                                                /^\//.test(rules[c].conditions[_c].case)
                                                && new RegExp(rules[c].conditions[_c].case).test(caseValue)
                                            ) {
                                                localRuleObj = ( typeof(rules[_r]) != 'undefined' ) ? rules[_r] : {};
                                                rules[_r] = merge(rules[c].conditions[_c].rules[_r], localRuleObj);
                                            }
                                            // check each field against rule only if rule exists 1/3
                                            if ( caseName != _r && typeof(rules[_r]) != 'undefined') {
                                                checkFieldAgainstRules(_r, rules, fields);
                                            }
                                        }
                                    } else {
                                        if ( typeof(rules[c].conditions[_c].rules[_r]) != 'undefined' ) {
                                            // depending on the case value, replace/merge original rule with condition rule
                                            //caseField = c.replace(/^\_case\_/, '');
                                            caseField = _r;
                                            caseValue = fields[caseField];

                                            if ( typeof($fields[caseField]) == 'undefined' ) {
                                                console.warn('ignoring case `'+ caseField +'`: field `'+ +'` not found in your DOM');
                                                continue;
                                            }
                                            // by default
                                            // if ( typeof(allFields[caseField]) == 'undefined' ) {
                                            //     allFields[caseField] =  $fields[caseField].value
                                            // }
                                            // caseValue =  allFields[caseField];
                                            // boolean caseValue
                                            if (
                                                isGFFCtx
                                                && /^(true|false)$/i.test(caseValue)
                                                && typeof(rules[caseField]) != 'undefined'
                                                && typeof(rules[caseField].isBoolean) != 'undefined'
                                                && /^(true)$/i.test(rules[caseField].isBoolean)
                                            ) {
                                                caseValue = ( /^(true)$/i.test(caseValue) ) ? true : false;
                                            }

                                            if (
                                                //rules[c].conditions[_c].case == caseValue
                                                typeof(rules[c].conditions[_c].rules[_r]) != 'undefined'
                                                // ||
                                                // // test for regexp
                                                // /^\//.test(rules[c].conditions[_c].case)
                                                // && new RegExp(rules[c].conditions[_c].case).test(caseValue)
                                            ) {
                                                localRuleObj = ( typeof(rules[c].conditions[_c].rules[_r]) != 'undefined' ) ? rules[c].conditions[_c].rules[_r] : {};
                                                //rules[_r] = merge(rules[c].conditions[_c].rules[_r], localRuleObj);
                                                rules[_r] = localRuleObj;
                                            }

                                            // check each field against rule only if rule exists 2/3
                                            //if ( caseName != _r && typeof(rules[_r]) != 'undefined' ) {
                                            if ( caseName != _r && typeof(rules[_r]) != 'undefined' && typeof(fields[_r]) != 'undefined' ) {
                                                checkFieldAgainstRules(_r, rules, fields);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    if (isInCase || caseName == field) continue;

                    // check each field against rule only if rule exists 3/3
                    if ( typeof(rules[field]) != 'undefined' ) {
                        //checkFieldAgainstRules(field, rules, fields);
                        checkFieldAgainstRules(field, rules, allFields);
                    }

                    if (hasCase) {
                        ++i; // add sub level
                        conditions = rules['_case_' + field]['conditions'];

                        if ( !conditions ) {
                            throw new Error('[ ginaFormValidator ] case `_case_'+field+'` found without `condition(s)` !\nPlease, check your delcaration for `_case_'+ field +'`');
                        }


                        for (let c = 0, cLen = conditions.length; c<cLen; ++c) {
                            // by default
                            //caseValue = fields[field];
                            caseValue =  allFields[field];

                            if (isGFFCtx) {
                                if (fields[field] == "true")
                                    caseValue = true;
                                else if (fields[field] == "false")
                                    caseValue = false;
                            }

                            //console.debug(caseValue +' VS '+ conditions[c]['case'], "->", (caseValue == conditions[c]['case'] || Array.isArray(conditions[c]['case']) && conditions[c]['case'].indexOf(caseValue) > -1) );
                            if (
                                conditions[c]['case'] === caseValue
                                ||
                                Array.isArray(conditions[c]['case']) && conditions[c]['case'].indexOf(caseValue) > -1
                                ||
                                /^\//.test(conditions[c]['case'])
                            ) {

                                //console.debug('[fields ] ' + JSON.stringify(fields, null, 4));
                                localRules = {};
                                // exclude case field if not declared in rules && not disabled
                                if (
                                    typeof(conditions[c]['rules'][field]) == 'undefined'
                                    && typeof(allFields[field]) == 'undefined'
                                    ||
                                    $fields[field].disabled
                                ) {
                                    conditions[c]['rules'][field] = { exclude: true }
                                }
                                for (var f in conditions[c]['rules']) {
                                    if (/^_comment$/i.test(f)) continue;
                                    //console.debug('F: ', f, '\nrule: '+ JSON.stringify(conditions[c]['rules'][f], null, 2));
                                    if ( /^\//.test(f) ) { // RegExp found

                                        re      = f.match(/\/(.*)\//).pop();
                                        flags   = f.replace('/'+ re +'/', '');
                                        // fix escaping "[" & "]"
                                        re      = re.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
                                        re      = new RegExp(re, flags);

                                        for (var localField in $fields) {
                                            if ( re.test(localField) ) {
                                                if ( /^\//.test(conditions[c]['case']) ) {
                                                    re      = conditions[c]['case'].match(/\/(.*)\//).pop();
                                                    flags   = conditions[c]['case'].replace('/'+ re +'/', '');
                                                    re      = new RegExp(re, flags);

                                                    if ( re.test(caseValue) ) {
                                                        localRules[localField] = conditions[c]['rules'][f];
                                                    }

                                                } else {
                                                    localRules[localField] = conditions[c]['rules'][f]
                                                }

                                                // we need to add it to fields list if not declared
                                                if (
                                                    typeof(fields[localField]) == 'undefined'
                                                    && typeof($fields[localField]) != 'undefined'
                                                    && typeof($fields[localField].value) != 'undefined'
                                                ) {
                                                    fields[localField] = $fields[localField].value;//caseValue is not goo here
                                                    if (isGFFCtx && /(true|false)/i.test(fields[localField] ) ) {
                                                        if (fields[localField] == "true")
                                                            fields[localField]  = true;
                                                        else if (fields[localField] == "false")
                                                            fields[localField]  = false;
                                                    }
                                                    d.addField(localField, fields[localField]);
                                                    if ( typeof(allRules[localField]) != 'undefined' ) {
                                                        localRules[localField] = merge(localRules[localField], allRules[localField])
                                                    }
                                                }
                                            }
                                        }

                                    } else {
                                        if ( /^\//.test(conditions[c]['case']) ) {

                                            re      = conditions[c]['case'].match(/\/(.*)\//).pop();
                                            flags   = conditions[c]['case'].replace('/'+ re +'/', '');
                                            // fix escaping "[" & "]"
                                            re      = re.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
                                            re      = new RegExp(re, flags);

                                            if ( re.test(caseValue) ) {
                                                localRules[f] = conditions[c]['rules'][f]
                                            }

                                        } else {
                                            localRules[f] = conditions[c]['rules'][f]
                                        }

                                        // we need to add it to fields list if not declared
                                        // if ( typeof(fields[f]) == 'undefined' ) {
                                        //     fields[f] = caseValue;
                                        // }
                                        if (
                                            typeof(fields[f]) == 'undefined'
                                            && typeof($fields[f]) != 'undefined'
                                            && typeof($fields[f].value) != 'undefined'
                                        ) {
                                            fields[f] = $fields[f].value;
                                            if (isGFFCtx && /(true|false)/i.test(fields[f] ) ) {
                                                if (fields[f] == "true")
                                                    fields[f]  = true;
                                                else if (fields[f] == "false")
                                                    fields[f]  = false;
                                            }

                                            d.addField(f, fields[f]);
                                            if ( typeof(allRules[f]) != 'undefined' ) {
                                                localRules[f] = merge(localRules[f], allRules[f])
                                            }
                                        }
                                    }
                                }



                                ++subLevelRules; // add sub level
                                if (isGFFCtx)
                                    forEachField($formOrElement, allFields, allRules, fields, $fields, localRules, cb, i);
                                else
                                    return forEachField($formOrElement, allFields, allRules, fields, $fields, localRules, cb, i);
                            }

                        }
                        --i;
                    }


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

                    if ( envIsDev && isGFFCtx && typeof(window.ginaToolbar) != 'undefined' && window.ginaToolbar ) {
                        // update toolbar
                        if (!gina.forms.validated)
                            gina.forms.validated = {};

                        if (!gina.forms.validated[id])
                            gina.forms.validated[id] = {};

                        var objCallback = {
                            id          : id,
                            validated   : data
                        };

                        window.ginaToolbar.update('forms', objCallback);
                    }
                } catch (err) {
                    throw err
                }
                hasParsedAllRules = true;
                if (!hasBeenValidated && asyncCount <= 0) {
                    if ( typeof(cb) != 'undefined' && typeof(cb) === 'function' ) {
                        cb._errors = d['getErrors']();
                        cb._data = d['toData']();
                        triggerEvent(gina, $formOrElement, 'validated.' + id, cb);
                    } else {
                        hasBeenValidated = true;
                        return {
                            'isValid'   : d['isValid'],
                            'error'     : errors,
                            'data'      : data
                        }
                    }
                }
            }
        }


        if (isGFFCtx) {
            addListener(gina, $formOrElement, evt, function(event) {
                event.preventDefault();

                if (!hasBeenValidated) {
                    hasBeenValidated    = true;
                    hasParsedAllRules   = false;
                    asyncCount          = 0;

                    var _cb         = event.detail;
                    var _data       = _cb._data || d['toData']();
                    var cbErrors    = _cb._errors || d['getErrors']() || null;

                    console.debug('instance errors: ', instance.$forms[id].errors, ' VS cbErrors: ', cbErrors, d['isValid'](), ' VS d.getErrors(): ',d['getErrors']() );

                    if ( cbErrors.count() > 0 && d['isValid']()) {
                        d['isValid'] = function() {
                            return false;
                        }
                    }

                    _cb({
                        'isValid'   : d['isValid'],
                        'error'     : cbErrors,
                        'data'      : formatData( _data )
                    });
                    removeListener(gina, event.target, 'validated.' + event.target.id);
                    return
                }
            });
        }

        // 0 is the starting level
        if (isGFFCtx)
            forEachField($formOrElement, allFields, allRules, fields, $fields, rules, cb, 0);
        else
            return forEachField($formOrElement, allFields, allRules, fields, $fields, rules, cb, 0);
    }

    var setupInstanceProto = function() {

        instance.target                 = document;
        instance.setOptions             = setOptions;
        instance.getFormById            = getFormById;
        instance.validateFormById       = validateFormById;
        instance.resetErrorsDisplay     = resetErrorsDisplay;
        instance.resetFields            = resetFields;
        instance.handleErrorsDisplay    = handleErrorsDisplay;
        instance.send                   = send;
        //instance.handleXhrResponse      = handleXhrResponse;
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

        //console.debug('Toolbar jquery is ', $.fn.jquery);

        var self = {
            version         : '1.0.3',
            foldingPaths    : {},
            foldingClass    : null,
            isUnfolded      : null,
            isXHR           : false,
            isValidator     : false,
            hasParsedUrls   : false
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
                    isUnfolded      : [],
                    debug           : {
                        forms   : {
                            active: false,
                            strategy: 'frontend' // by default
                        }
                    }
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
                var txt = ($json) ? $json.text() : '';
                if (txt == '' || txt == 'null' ) {
                    $json.text('Empty')
                } else {
                    jsonObject = JSON.parse( txt );
                    ginaJsonObject = JSON.parse($ginaJson.text());

                    $json.text('');

                    // backing up document data for restore action
                    if (!originalData) {

                        originalData = {
                            jsonObject      : JSON.clone(jsonObject),
                            ginaJsonObject  : JSON.clone( ginaJsonObject)
                        };
                        lastJsonObjectState = {}; // jsonObject.data

                    }
                }

            } catch (err) {

                var sectionStr = ( section ) ? ' [ '+ section + ' ] ' : ' ';
                var _err = 'Could not load'+ sectionStr +'json\n' + (err.stack||err.message||err);
                if ($json) {
                    $json.text(_err);
                } else {
                    throw _err;
                }

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
                delete jsonObject.environment.reverseRouting;
                delete ginaJsonObject.environment.reverseRouting;
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
                } //else
                if ( /^(data-xhr|view-xhr)$/.test(section) ) {

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
                            lastJsonObjectState.data = JSON.clone(jsonObject[section]);
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

                } //else
                if ( /^(el-xhr)$/.test(section) ) {
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
                } //else
                if ( /^(forms)$/.test(section) ) {
                    isXHR = true;
                    self.isValidator = true;

                    var $form = $('#gina-toolbar-form-' + data.id);
                    // for live changes (eg.: on `Validator::getFormById()` call)
                    if ( !$form.length ) {
                        // crearte toolbar entry for the new form
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
                    }

                    // form data sent
                    if ( typeof(data.rules) != 'undefined' ) {
                        updateForm(data.id, 'rules', data.rules, isXHR)
                    }

                    // form errors
                    if ( typeof(data.errors) != 'undefined' && data.errors.count() > 0 ) {
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

            if ( !section || section == 'el-xhr' && !self.hasParsedUrls) {
                self.hasParsedUrls = (section && section == 'el-xhr' ) ? true : false;
                parseUrls(section);
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
            var txt = ($json) ? $json.text() : '';
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
                        if ( typeof(self.foldingClass) != 'undefined' )
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
                    isEmptyClass = (obj[i].count() > 0 || typeof(ginaObj[i]) != 'undefined' && ginaObj[i].count() > 0) ? '' : ' is-empty';

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
                    isEmptyClass = (obj[i].length > 0 || typeof(ginaObj[i]) != 'undefined' && ginaObj[i].length > 0) ? '' : ' is-empty';

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

                        //if (/^_comment/.test(i) ) continue;

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

                        //if (/^_comment/.test(i) ) continue;

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

        var parseUrls = function(section) {

            var $el = null;
            var $currentPopin = (gina.hasPopinHandler) ? gina.popin.getActivePopin() : null;
            var isPopinContext = ( gina.hasPopinHandler ) ? true : false;
            if ( isPopinContext ) {
                $el = $('#' + $currentPopin.id );
            } else {
                $el = $('body');
            }

            // look for `404: `
            var found = {}
                , foundStr = null
                , formMethod = null
                , f = 0
                , fLen = 0
            ;
            var matched = $el.html().match(/404\:\[(.+)\](.+)@(.+)\"/gm);
            if (matched) {
                f = 0; fLen = matched.length;
                for (; f < fLen; ++f) {
                    foundStr = matched[f].replace(/\"(.*)|\"/g, '');
                    formMethod = foundStr.match(/\[(.*)\]/g, '')[0].replace(/\[|\]/g,'');

                    routing.getRouteByUrl(foundStr, formMethod)
                }
            }

            printLogs();

            //console.debug('popinIsActive: '+ isPopinContext +'isXHR: ', self.isXHR, ' -> ' + section, routing.notFound);
        }

        var printLogs = function() {
            fLen = routing.notFound.count();
            if ( fLen > 0 ) {
                for (f in routing.notFound) {
                    console.warn( '(x'+ routing.notFound[f].count +') ' + f + ' => ' + routing.notFound[f].message );
                }
            }
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

                    if (!formMethod) {
                        console.warn('[ ToolbarFormHelper::UndefinedMethod : form `'+ attributes['id'].nodeValue +'` method attribute cannot be left undefined !');
                    }

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

            if ($section.length > 0) { // update

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
            self.hasParsedUrls = false;
            routing.notFound = {};
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
define('gina', [ 'require', 'vendor/uuid', 'utils/merge', 'utils/events', 'helpers/prototypes', 'helpers/dateFormat', 'gina/toolbar' ], function (require) {


    var eventsHandler   = require('utils/events'); // events handler
    var merge           = require('utils/merge');
    var dateFormat      = require('helpers/dateFormat')();
    var prototypes      = require('helpers/prototypes')({ dateFormat: dateFormat });
    var uuid            = require('vendor/uuid');



    /**
     * Imports & definitions
     * */

    var jQuery = (window['jQuery']) ? window['jQuery'] : null;

    if (!window.process ) {
        (function(window, nextTick, process, prefixes, i, p, fnc) {
            p = window[process] || (window[process] = {});
            while (!fnc && i < prefixes.length) {
                fnc = window[prefixes[i++] + 'requestAnimationFrame'];
            }
            p[nextTick] = p[nextTick] || (fnc && fnc.bind(window)) || window.setImmediate || window.setTimeout;
        })(window, 'nextTick', 'process', 'r webkitR mozR msR oR'.split(' '), 0);
    }

    if (!window.getComputedStyle) {
        /**
         * Returns the roster widget element.
         * @this {Window}
         * @returns {ComputedStyle}
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
/*!
 * Engine.IO v6.2.2
 * (c) 2014-2022 Guillermo Rauch
 * Released under the MIT License.
 */
!function(t,e){"object"==typeof exports&&"undefined"!=typeof module?module.exports=e():"function"==typeof define&&define.amd?define('vendor/engine.io',e):(t="undefined"!=typeof globalThis?globalThis:t||self).eio=e()}(this,(function(){"use strict";function t(e){return t="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(t){return typeof t}:function(t){return t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t},t(e)}function e(t,e){if(!(t instanceof e))throw new TypeError("Cannot call a class as a function")}function r(t,e){for(var r=0;r<e.length;r++){var n=e[r];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(t,n.key,n)}}function n(t,e,n){return e&&r(t.prototype,e),n&&r(t,n),t}function o(){return o=Object.assign||function(t){for(var e=1;e<arguments.length;e++){var r=arguments[e];for(var n in r)Object.prototype.hasOwnProperty.call(r,n)&&(t[n]=r[n])}return t},o.apply(this,arguments)}function i(t,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");t.prototype=Object.create(e&&e.prototype,{constructor:{value:t,writable:!0,configurable:!0}}),e&&a(t,e)}function s(t){return s=Object.setPrototypeOf?Object.getPrototypeOf:function(t){return t.__proto__||Object.getPrototypeOf(t)},s(t)}function a(t,e){return a=Object.setPrototypeOf||function(t,e){return t.__proto__=e,t},a(t,e)}function u(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Date.prototype.toString.call(Reflect.construct(Date,[],(function(){}))),!0}catch(t){return!1}}function c(t,e,r){return c=u()?Reflect.construct:function(t,e,r){var n=[null];n.push.apply(n,e);var o=new(Function.bind.apply(t,n));return r&&a(o,r.prototype),o},c.apply(null,arguments)}function p(t){var e="function"==typeof Map?new Map:void 0;return p=function(t){if(null===t||(r=t,-1===Function.toString.call(r).indexOf("[native code]")))return t;var r;if("function"!=typeof t)throw new TypeError("Super expression must either be null or a function");if(void 0!==e){if(e.has(t))return e.get(t);e.set(t,n)}function n(){return c(t,arguments,s(this).constructor)}return n.prototype=Object.create(t.prototype,{constructor:{value:n,enumerable:!1,writable:!0,configurable:!0}}),a(n,t)},p(t)}function h(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}function l(t,e){return!e||"object"!=typeof e&&"function"!=typeof e?h(t):e}function f(t){var e=u();return function(){var r,n=s(t);if(e){var o=s(this).constructor;r=Reflect.construct(n,arguments,o)}else r=n.apply(this,arguments);return l(this,r)}}function d(t,e,r){return d="undefined"!=typeof Reflect&&Reflect.get?Reflect.get:function(t,e,r){var n=function(t,e){for(;!Object.prototype.hasOwnProperty.call(t,e)&&null!==(t=s(t)););return t}(t,e);if(n){var o=Object.getOwnPropertyDescriptor(n,e);return o.get?o.get.call(r):o.value}},d(t,e,r||t)}var y=Object.create(null);y.open="0",y.close="1",y.ping="2",y.pong="3",y.message="4",y.upgrade="5",y.noop="6";var v=Object.create(null);Object.keys(y).forEach((function(t){v[y[t]]=t}));for(var m={type:"error",data:"parser error"},g="function"==typeof Blob||"undefined"!=typeof Blob&&"[object BlobConstructor]"===Object.prototype.toString.call(Blob),b="function"==typeof ArrayBuffer,k=function(t,e,r){var n,o=t.type,i=t.data;return g&&i instanceof Blob?e?r(i):w(i,r):b&&(i instanceof ArrayBuffer||(n=i,"function"==typeof ArrayBuffer.isView?ArrayBuffer.isView(n):n&&n.buffer instanceof ArrayBuffer))?e?r(i):w(new Blob([i]),r):r(y[o]+(i||""))},w=function(t,e){var r=new FileReader;return r.onload=function(){var t=r.result.split(",")[1];e("b"+t)},r.readAsDataURL(t)},T="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",S="undefined"==typeof Uint8Array?[]:new Uint8Array(256),R=0;R<T.length;R++)S[T.charCodeAt(R)]=R;var x="function"==typeof ArrayBuffer,O=function(t,e){if("string"!=typeof t)return{type:"message",data:P(t,e)};var r=t.charAt(0);return"b"===r?{type:"message",data:E(t.substring(1),e)}:v[r]?t.length>1?{type:v[r],data:t.substring(1)}:{type:v[r]}:m},E=function(t,e){if(x){var r=function(t){var e,r,n,o,i,s=.75*t.length,a=t.length,u=0;"="===t[t.length-1]&&(s--,"="===t[t.length-2]&&s--);var c=new ArrayBuffer(s),p=new Uint8Array(c);for(e=0;e<a;e+=4)r=S[t.charCodeAt(e)],n=S[t.charCodeAt(e+1)],o=S[t.charCodeAt(e+2)],i=S[t.charCodeAt(e+3)],p[u++]=r<<2|n>>4,p[u++]=(15&n)<<4|o>>2,p[u++]=(3&o)<<6|63&i;return c}(t);return P(r,e)}return{base64:!0,data:t}},P=function(t,e){return"blob"===e&&t instanceof ArrayBuffer?new Blob([t]):t},B=String.fromCharCode(30);function C(t){if(t)return function(t){for(var e in C.prototype)t[e]=C.prototype[e];return t}(t)}C.prototype.on=C.prototype.addEventListener=function(t,e){return this._callbacks=this._callbacks||{},(this._callbacks["$"+t]=this._callbacks["$"+t]||[]).push(e),this},C.prototype.once=function(t,e){function r(){this.off(t,r),e.apply(this,arguments)}return r.fn=e,this.on(t,r),this},C.prototype.off=C.prototype.removeListener=C.prototype.removeAllListeners=C.prototype.removeEventListener=function(t,e){if(this._callbacks=this._callbacks||{},0==arguments.length)return this._callbacks={},this;var r,n=this._callbacks["$"+t];if(!n)return this;if(1==arguments.length)return delete this._callbacks["$"+t],this;for(var o=0;o<n.length;o++)if((r=n[o])===e||r.fn===e){n.splice(o,1);break}return 0===n.length&&delete this._callbacks["$"+t],this},C.prototype.emit=function(t){this._callbacks=this._callbacks||{};for(var e=new Array(arguments.length-1),r=this._callbacks["$"+t],n=1;n<arguments.length;n++)e[n-1]=arguments[n];if(r){n=0;for(var o=(r=r.slice(0)).length;n<o;++n)r[n].apply(this,e)}return this},C.prototype.emitReserved=C.prototype.emit,C.prototype.listeners=function(t){return this._callbacks=this._callbacks||{},this._callbacks["$"+t]||[]},C.prototype.hasListeners=function(t){return!!this.listeners(t).length};var L="undefined"!=typeof self?self:"undefined"!=typeof window?window:Function("return this")();function q(t){for(var e=arguments.length,r=new Array(e>1?e-1:0),n=1;n<e;n++)r[n-1]=arguments[n];return r.reduce((function(e,r){return t.hasOwnProperty(r)&&(e[r]=t[r]),e}),{})}var A=setTimeout,j=clearTimeout;function _(t,e){e.useNativeTimers?(t.setTimeoutFn=A.bind(L),t.clearTimeoutFn=j.bind(L)):(t.setTimeoutFn=setTimeout.bind(L),t.clearTimeoutFn=clearTimeout.bind(L))}var U,H=function(t){i(n,t);var r=f(n);function n(t,o,i){var s;return e(this,n),(s=r.call(this,t)).description=o,s.context=i,s.type="TransportError",s}return n}(p(Error)),F=function(t){i(o,t);var r=f(o);function o(t){var n;return e(this,o),(n=r.call(this)).writable=!1,_(h(n),t),n.opts=t,n.query=t.query,n.readyState="",n.socket=t.socket,n}return n(o,[{key:"onError",value:function(t,e,r){return d(s(o.prototype),"emitReserved",this).call(this,"error",new H(t,e,r)),this}},{key:"open",value:function(){return"closed"!==this.readyState&&""!==this.readyState||(this.readyState="opening",this.doOpen()),this}},{key:"close",value:function(){return"opening"!==this.readyState&&"open"!==this.readyState||(this.doClose(),this.onClose()),this}},{key:"send",value:function(t){"open"===this.readyState&&this.write(t)}},{key:"onOpen",value:function(){this.readyState="open",this.writable=!0,d(s(o.prototype),"emitReserved",this).call(this,"open")}},{key:"onData",value:function(t){var e=O(t,this.socket.binaryType);this.onPacket(e)}},{key:"onPacket",value:function(t){d(s(o.prototype),"emitReserved",this).call(this,"packet",t)}},{key:"onClose",value:function(t){this.readyState="closed",d(s(o.prototype),"emitReserved",this).call(this,"close",t)}}]),o}(C),D="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_".split(""),M={},I=0,W=0;function N(t){var e="";do{e=D[t%64]+e,t=Math.floor(t/64)}while(t>0);return e}function X(){var t=N(+new Date);return t!==U?(I=0,U=t):t+"."+N(I++)}for(;W<64;W++)M[D[W]]=W;function $(t){var e="";for(var r in t)t.hasOwnProperty(r)&&(e.length&&(e+="&"),e+=encodeURIComponent(r)+"="+encodeURIComponent(t[r]));return e}function z(t){for(var e={},r=t.split("&"),n=0,o=r.length;n<o;n++){var i=r[n].split("=");e[decodeURIComponent(i[0])]=decodeURIComponent(i[1])}return e}var V=!1;try{V="undefined"!=typeof XMLHttpRequest&&"withCredentials"in new XMLHttpRequest}catch(t){}var G=V;function J(t){var e=t.xdomain;try{if("undefined"!=typeof XMLHttpRequest&&(!e||G))return new XMLHttpRequest}catch(t){}if(!e)try{return new(L[["Active"].concat("Object").join("X")])("Microsoft.XMLHTTP")}catch(t){}}function K(){}var Q=null!=new J({xdomain:!1}).responseType,Y=function(t){i(s,t);var r=f(s);function s(t){var n;if(e(this,s),(n=r.call(this,t)).polling=!1,"undefined"!=typeof location){var o="https:"===location.protocol,i=location.port;i||(i=o?"443":"80"),n.xd="undefined"!=typeof location&&t.hostname!==location.hostname||i!==t.port,n.xs=t.secure!==o}var a=t&&t.forceBase64;return n.supportsBinary=Q&&!a,n}return n(s,[{key:"doOpen",value:function(){this.poll()}},{key:"pause",value:function(t){var e=this;this.readyState="pausing";var r=function(){e.readyState="paused",t()};if(this.polling||!this.writable){var n=0;this.polling&&(n++,this.once("pollComplete",(function(){--n||r()}))),this.writable||(n++,this.once("drain",(function(){--n||r()})))}else r()}},{key:"poll",value:function(){this.polling=!0,this.doPoll(),this.emitReserved("poll")}},{key:"onData",value:function(t){var e=this;(function(t,e){for(var r=t.split(B),n=[],o=0;o<r.length;o++){var i=O(r[o],e);if(n.push(i),"error"===i.type)break}return n})(t,this.socket.binaryType).forEach((function(t){if("opening"===e.readyState&&"open"===t.type&&e.onOpen(),"close"===t.type)return e.onClose({description:"transport closed by the server"}),!1;e.onPacket(t)})),"closed"!==this.readyState&&(this.polling=!1,this.emitReserved("pollComplete"),"open"===this.readyState&&this.poll())}},{key:"doClose",value:function(){var t=this,e=function(){t.write([{type:"close"}])};"open"===this.readyState?e():this.once("open",e)}},{key:"write",value:function(t){var e=this;this.writable=!1,function(t,e){var r=t.length,n=new Array(r),o=0;t.forEach((function(t,i){k(t,!1,(function(t){n[i]=t,++o===r&&e(n.join(B))}))}))}(t,(function(t){e.doWrite(t,(function(){e.writable=!0,e.emitReserved("drain")}))}))}},{key:"uri",value:function(){var t=this.query||{},e=this.opts.secure?"https":"http",r="";!1!==this.opts.timestampRequests&&(t[this.opts.timestampParam]=X()),this.supportsBinary||t.sid||(t.b64=1),this.opts.port&&("https"===e&&443!==Number(this.opts.port)||"http"===e&&80!==Number(this.opts.port))&&(r=":"+this.opts.port);var n=$(t);return e+"://"+(-1!==this.opts.hostname.indexOf(":")?"["+this.opts.hostname+"]":this.opts.hostname)+r+this.opts.path+(n.length?"?"+n:"")}},{key:"request",value:function(){var t=arguments.length>0&&void 0!==arguments[0]?arguments[0]:{};return o(t,{xd:this.xd,xs:this.xs},this.opts),new Z(this.uri(),t)}},{key:"doWrite",value:function(t,e){var r=this,n=this.request({method:"POST",data:t});n.on("success",e),n.on("error",(function(t,e){r.onError("xhr post error",t,e)}))}},{key:"doPoll",value:function(){var t=this,e=this.request();e.on("data",this.onData.bind(this)),e.on("error",(function(e,r){t.onError("xhr poll error",e,r)})),this.pollXhr=e}},{key:"name",get:function(){return"polling"}}]),s}(F),Z=function(t){i(o,t);var r=f(o);function o(t,n){var i;return e(this,o),_(h(i=r.call(this)),n),i.opts=n,i.method=n.method||"GET",i.uri=t,i.async=!1!==n.async,i.data=void 0!==n.data?n.data:null,i.create(),i}return n(o,[{key:"create",value:function(){var t=this,e=q(this.opts,"agent","pfx","key","passphrase","cert","ca","ciphers","rejectUnauthorized","autoUnref");e.xdomain=!!this.opts.xd,e.xscheme=!!this.opts.xs;var r=this.xhr=new J(e);try{r.open(this.method,this.uri,this.async);try{if(this.opts.extraHeaders)for(var n in r.setDisableHeaderCheck&&r.setDisableHeaderCheck(!0),this.opts.extraHeaders)this.opts.extraHeaders.hasOwnProperty(n)&&r.setRequestHeader(n,this.opts.extraHeaders[n])}catch(t){}if("POST"===this.method)try{r.setRequestHeader("Content-type","text/plain;charset=UTF-8")}catch(t){}try{r.setRequestHeader("Accept","*/*")}catch(t){}"withCredentials"in r&&(r.withCredentials=this.opts.withCredentials),this.opts.requestTimeout&&(r.timeout=this.opts.requestTimeout),r.onreadystatechange=function(){4===r.readyState&&(200===r.status||1223===r.status?t.onLoad():t.setTimeoutFn((function(){t.onError("number"==typeof r.status?r.status:0)}),0))},r.send(this.data)}catch(e){return void this.setTimeoutFn((function(){t.onError(e)}),0)}"undefined"!=typeof document&&(this.index=o.requestsCount++,o.requests[this.index]=this)}},{key:"onError",value:function(t){this.emitReserved("error",t,this.xhr),this.cleanup(!0)}},{key:"cleanup",value:function(t){if(void 0!==this.xhr&&null!==this.xhr){if(this.xhr.onreadystatechange=K,t)try{this.xhr.abort()}catch(t){}"undefined"!=typeof document&&delete o.requests[this.index],this.xhr=null}}},{key:"onLoad",value:function(){var t=this.xhr.responseText;null!==t&&(this.emitReserved("data",t),this.emitReserved("success"),this.cleanup())}},{key:"abort",value:function(){this.cleanup()}}]),o}(C);if(Z.requestsCount=0,Z.requests={},"undefined"!=typeof document)if("function"==typeof attachEvent)attachEvent("onunload",tt);else if("function"==typeof addEventListener){addEventListener("onpagehide"in L?"pagehide":"unload",tt,!1)}function tt(){for(var t in Z.requests)Z.requests.hasOwnProperty(t)&&Z.requests[t].abort()}var et="function"==typeof Promise&&"function"==typeof Promise.resolve?function(t){return Promise.resolve().then(t)}:function(t,e){return e(t,0)},rt=L.WebSocket||L.MozWebSocket,nt="undefined"!=typeof navigator&&"string"==typeof navigator.product&&"reactnative"===navigator.product.toLowerCase(),ot=function(t){i(o,t);var r=f(o);function o(t){var n;return e(this,o),(n=r.call(this,t)).supportsBinary=!t.forceBase64,n}return n(o,[{key:"doOpen",value:function(){if(this.check()){var t=this.uri(),e=this.opts.protocols,r=nt?{}:q(this.opts,"agent","perMessageDeflate","pfx","key","passphrase","cert","ca","ciphers","rejectUnauthorized","localAddress","protocolVersion","origin","maxPayload","family","checkServerIdentity");this.opts.extraHeaders&&(r.headers=this.opts.extraHeaders);try{this.ws=nt?new rt(t,e,r):e?new rt(t,e):new rt(t)}catch(t){return this.emitReserved("error",t)}this.ws.binaryType=this.socket.binaryType||"arraybuffer",this.addEventListeners()}}},{key:"addEventListeners",value:function(){var t=this;this.ws.onopen=function(){t.opts.autoUnref&&t.ws._socket.unref(),t.onOpen()},this.ws.onclose=function(e){return t.onClose({description:"websocket connection closed",context:e})},this.ws.onmessage=function(e){return t.onData(e.data)},this.ws.onerror=function(e){return t.onError("websocket error",e)}}},{key:"write",value:function(t){var e=this;this.writable=!1;for(var r=function(r){var n=t[r],o=r===t.length-1;k(n,e.supportsBinary,(function(t){try{e.ws.send(t)}catch(t){}o&&et((function(){e.writable=!0,e.emitReserved("drain")}),e.setTimeoutFn)}))},n=0;n<t.length;n++)r(n)}},{key:"doClose",value:function(){void 0!==this.ws&&(this.ws.close(),this.ws=null)}},{key:"uri",value:function(){var t=this.query||{},e=this.opts.secure?"wss":"ws",r="";this.opts.port&&("wss"===e&&443!==Number(this.opts.port)||"ws"===e&&80!==Number(this.opts.port))&&(r=":"+this.opts.port),this.opts.timestampRequests&&(t[this.opts.timestampParam]=X()),this.supportsBinary||(t.b64=1);var n=$(t);return e+"://"+(-1!==this.opts.hostname.indexOf(":")?"["+this.opts.hostname+"]":this.opts.hostname)+r+this.opts.path+(n.length?"?"+n:"")}},{key:"check",value:function(){return!!rt}},{key:"name",get:function(){return"websocket"}}]),o}(F),it={websocket:ot,polling:Y},st=/^(?:(?![^:@]+:[^:@\/]*@)(http|https|ws|wss):\/\/)?((?:(([^:@]*)(?::([^:@]*))?)?@)?((?:[a-f0-9]{0,4}:){2,7}[a-f0-9]{0,4}|[^:\/?#]*)(?::(\d*))?)(((\/(?:[^?#](?![^?#\/]*\.[^?#\/.]+(?:[?#]|$)))*\/?)?([^?#\/]*))(?:\?([^#]*))?(?:#(.*))?)/,at=["source","protocol","authority","userInfo","user","password","host","port","relative","path","directory","file","query","anchor"];function ut(t){var e=t,r=t.indexOf("["),n=t.indexOf("]");-1!=r&&-1!=n&&(t=t.substring(0,r)+t.substring(r,n).replace(/:/g,";")+t.substring(n,t.length));for(var o,i,s=st.exec(t||""),a={},u=14;u--;)a[at[u]]=s[u]||"";return-1!=r&&-1!=n&&(a.source=e,a.host=a.host.substring(1,a.host.length-1).replace(/;/g,":"),a.authority=a.authority.replace("[","").replace("]","").replace(/;/g,":"),a.ipv6uri=!0),a.pathNames=function(t,e){var r=/\/{2,9}/g,n=e.replace(r,"/").split("/");"/"!=e.substr(0,1)&&0!==e.length||n.splice(0,1);"/"==e.substr(e.length-1,1)&&n.splice(n.length-1,1);return n}(0,a.path),a.queryKey=(o=a.query,i={},o.replace(/(?:^|&)([^&=]*)=?([^&]*)/g,(function(t,e,r){e&&(i[e]=r)})),i),a}var ct=function(r){i(a,r);var s=f(a);function a(r){var n,i=arguments.length>1&&void 0!==arguments[1]?arguments[1]:{};return e(this,a),n=s.call(this),r&&"object"===t(r)&&(i=r,r=null),r?(r=ut(r),i.hostname=r.host,i.secure="https"===r.protocol||"wss"===r.protocol,i.port=r.port,r.query&&(i.query=r.query)):i.host&&(i.hostname=ut(i.host).host),_(h(n),i),n.secure=null!=i.secure?i.secure:"undefined"!=typeof location&&"https:"===location.protocol,i.hostname&&!i.port&&(i.port=n.secure?"443":"80"),n.hostname=i.hostname||("undefined"!=typeof location?location.hostname:"localhost"),n.port=i.port||("undefined"!=typeof location&&location.port?location.port:n.secure?"443":"80"),n.transports=i.transports||["polling","websocket"],n.readyState="",n.writeBuffer=[],n.prevBufferLen=0,n.opts=o({path:"/engine.io",agent:!1,withCredentials:!1,upgrade:!0,timestampParam:"t",rememberUpgrade:!1,rejectUnauthorized:!0,perMessageDeflate:{threshold:1024},transportOptions:{},closeOnBeforeunload:!0},i),n.opts.path=n.opts.path.replace(/\/$/,"")+"/","string"==typeof n.opts.query&&(n.opts.query=z(n.opts.query)),n.id=null,n.upgrades=null,n.pingInterval=null,n.pingTimeout=null,n.pingTimeoutTimer=null,"function"==typeof addEventListener&&(n.opts.closeOnBeforeunload&&addEventListener("beforeunload",(function(){n.transport&&(n.transport.removeAllListeners(),n.transport.close())}),!1),"localhost"!==n.hostname&&(n.offlineEventListener=function(){n.onClose("transport close",{description:"network connection lost"})},addEventListener("offline",n.offlineEventListener,!1))),n.open(),n}return n(a,[{key:"createTransport",value:function(t){var e=o({},this.opts.query);e.EIO=4,e.transport=t,this.id&&(e.sid=this.id);var r=o({},this.opts.transportOptions[t],this.opts,{query:e,socket:this,hostname:this.hostname,secure:this.secure,port:this.port});return new it[t](r)}},{key:"open",value:function(){var t,e=this;if(this.opts.rememberUpgrade&&a.priorWebsocketSuccess&&-1!==this.transports.indexOf("websocket"))t="websocket";else{if(0===this.transports.length)return void this.setTimeoutFn((function(){e.emitReserved("error","No transports available")}),0);t=this.transports[0]}this.readyState="opening";try{t=this.createTransport(t)}catch(t){return this.transports.shift(),void this.open()}t.open(),this.setTransport(t)}},{key:"setTransport",value:function(t){var e=this;this.transport&&this.transport.removeAllListeners(),this.transport=t,t.on("drain",this.onDrain.bind(this)).on("packet",this.onPacket.bind(this)).on("error",this.onError.bind(this)).on("close",(function(t){return e.onClose("transport close",t)}))}},{key:"probe",value:function(t){var e=this,r=this.createTransport(t),n=!1;a.priorWebsocketSuccess=!1;var o=function(){n||(r.send([{type:"ping",data:"probe"}]),r.once("packet",(function(t){if(!n)if("pong"===t.type&&"probe"===t.data){if(e.upgrading=!0,e.emitReserved("upgrading",r),!r)return;a.priorWebsocketSuccess="websocket"===r.name,e.transport.pause((function(){n||"closed"!==e.readyState&&(h(),e.setTransport(r),r.send([{type:"upgrade"}]),e.emitReserved("upgrade",r),r=null,e.upgrading=!1,e.flush())}))}else{var o=new Error("probe error");o.transport=r.name,e.emitReserved("upgradeError",o)}})))};function i(){n||(n=!0,h(),r.close(),r=null)}var s=function(t){var n=new Error("probe error: "+t);n.transport=r.name,i(),e.emitReserved("upgradeError",n)};function u(){s("transport closed")}function c(){s("socket closed")}function p(t){r&&t.name!==r.name&&i()}var h=function(){r.removeListener("open",o),r.removeListener("error",s),r.removeListener("close",u),e.off("close",c),e.off("upgrading",p)};r.once("open",o),r.once("error",s),r.once("close",u),this.once("close",c),this.once("upgrading",p),r.open()}},{key:"onOpen",value:function(){if(this.readyState="open",a.priorWebsocketSuccess="websocket"===this.transport.name,this.emitReserved("open"),this.flush(),"open"===this.readyState&&this.opts.upgrade&&this.transport.pause)for(var t=0,e=this.upgrades.length;t<e;t++)this.probe(this.upgrades[t])}},{key:"onPacket",value:function(t){if("opening"===this.readyState||"open"===this.readyState||"closing"===this.readyState)switch(this.emitReserved("packet",t),this.emitReserved("heartbeat"),t.type){case"open":this.onHandshake(JSON.parse(t.data));break;case"ping":this.resetPingTimeout(),this.sendPacket("pong"),this.emitReserved("ping"),this.emitReserved("pong");break;case"error":var e=new Error("server error");e.code=t.data,this.onError(e);break;case"message":this.emitReserved("data",t.data),this.emitReserved("message",t.data)}}},{key:"onHandshake",value:function(t){this.emitReserved("handshake",t),this.id=t.sid,this.transport.query.sid=t.sid,this.upgrades=this.filterUpgrades(t.upgrades),this.pingInterval=t.pingInterval,this.pingTimeout=t.pingTimeout,this.maxPayload=t.maxPayload,this.onOpen(),"closed"!==this.readyState&&this.resetPingTimeout()}},{key:"resetPingTimeout",value:function(){var t=this;this.clearTimeoutFn(this.pingTimeoutTimer),this.pingTimeoutTimer=this.setTimeoutFn((function(){t.onClose("ping timeout")}),this.pingInterval+this.pingTimeout),this.opts.autoUnref&&this.pingTimeoutTimer.unref()}},{key:"onDrain",value:function(){this.writeBuffer.splice(0,this.prevBufferLen),this.prevBufferLen=0,0===this.writeBuffer.length?this.emitReserved("drain"):this.flush()}},{key:"flush",value:function(){if("closed"!==this.readyState&&this.transport.writable&&!this.upgrading&&this.writeBuffer.length){var t=this.getWritablePackets();this.transport.send(t),this.prevBufferLen=t.length,this.emitReserved("flush")}}},{key:"getWritablePackets",value:function(){if(!(this.maxPayload&&"polling"===this.transport.name&&this.writeBuffer.length>1))return this.writeBuffer;for(var t,e=1,r=0;r<this.writeBuffer.length;r++){var n=this.writeBuffer[r].data;if(n&&(e+="string"==typeof(t=n)?function(t){for(var e=0,r=0,n=0,o=t.length;n<o;n++)(e=t.charCodeAt(n))<128?r+=1:e<2048?r+=2:e<55296||e>=57344?r+=3:(n++,r+=4);return r}(t):Math.ceil(1.33*(t.byteLength||t.size))),r>0&&e>this.maxPayload)return this.writeBuffer.slice(0,r);e+=2}return this.writeBuffer}},{key:"write",value:function(t,e,r){return this.sendPacket("message",t,e,r),this}},{key:"send",value:function(t,e,r){return this.sendPacket("message",t,e,r),this}},{key:"sendPacket",value:function(t,e,r,n){if("function"==typeof e&&(n=e,e=void 0),"function"==typeof r&&(n=r,r=null),"closing"!==this.readyState&&"closed"!==this.readyState){(r=r||{}).compress=!1!==r.compress;var o={type:t,data:e,options:r};this.emitReserved("packetCreate",o),this.writeBuffer.push(o),n&&this.once("flush",n),this.flush()}}},{key:"close",value:function(){var t=this,e=function(){t.onClose("forced close"),t.transport.close()},r=function r(){t.off("upgrade",r),t.off("upgradeError",r),e()},n=function(){t.once("upgrade",r),t.once("upgradeError",r)};return"opening"!==this.readyState&&"open"!==this.readyState||(this.readyState="closing",this.writeBuffer.length?this.once("drain",(function(){t.upgrading?n():e()})):this.upgrading?n():e()),this}},{key:"onError",value:function(t){a.priorWebsocketSuccess=!1,this.emitReserved("error",t),this.onClose("transport error",t)}},{key:"onClose",value:function(t,e){"opening"!==this.readyState&&"open"!==this.readyState&&"closing"!==this.readyState||(this.clearTimeoutFn(this.pingTimeoutTimer),this.transport.removeAllListeners("close"),this.transport.close(),this.transport.removeAllListeners(),"function"==typeof removeEventListener&&removeEventListener("offline",this.offlineEventListener,!1),this.readyState="closed",this.id=null,this.emitReserved("close",t,e),this.writeBuffer=[],this.prevBufferLen=0)}},{key:"filterUpgrades",value:function(t){for(var e=[],r=0,n=t.length;r<n;r++)~this.transports.indexOf(t[r])&&e.push(t[r]);return e}}]),a}(C);ct.protocol=4;return function(t,e){return new ct(t,e)}}));
//# sourceMappingURL=engine.io.min.js.map
;
function BindingHelper(handlerContext) {

    var self = {};
    if ( typeof(handlerContext) != 'undefined' ) {
        self = handlerContext
    }

    /**
     * process bindings
     *
     * e.g.:
     * result.bindings =
     * [
     *     // close current popin
     *     {
     *         call: 'closeActivePopin'
     *     },
     *     // mark notification as read
     *     {
     *         call: 'onNotification',
     *         payload: {
     *             id: obj.notificationId,
     *             action: 'mark-as-read'
     *         }
     *     },
     *     {
     *         handler: 'DocumentHandler', // targeting another handler
     *         call: 'notify' // this method must be public
     *     }
     * ]
     *
     * @param {array} bindings
     * @param {number} [len]
     * @param {number} [i]
     */
    self.process = function(bindings, len, i) {
        // handle errors first
        if ( typeof(bindings) == 'undefined' || !Array.isArray(bindings) ) {
            throw new Error('`bindings` must be a defined array')
        }
        if ( typeof(len) == 'undefined' ) {
            len = bindings.length;
            i = 0;
        }

        if ( !bindings[i] )
            return;

        var handleObject = bindings[i];
        if ( typeof(handleObject.call) == 'undefined' )
            throw new Error('`bindings.['+ i +'].call` is required !');

        if ( typeof(self[ handleObject.call ]) != 'function' )
            throw new Error('`bindingContext.'+ handleObject.call +'` is not a function');

        // process the collection
        var hCall = handleObject.call;
        delete handleObject.call;

        try {

            // !! targeted handler instance must be exposed to the window object
            if ( typeof(handleObject.handler) != 'undefined' ) {

                if ( !window[ handleObject.handler ] )
                    throw new Error('`'+ handleObject.handler +'` could not be reached. You must expose it to the `window` do object before any call.');

                var hHandler = handleObject.handler;
                delete handleObject.handler;

                window[ hHandler ].apply( this, Object.values(handleObject) );
                //restore
                handleObject.handler = hHandler
            } else { // by default, will go to main handler or the one listening to xhr results
                self[ hCall ].apply( this, Object.values(handleObject) );
            }

            //restore
            handleObject.call = hCall;
        } catch (err) {
            console.error('BindingHelper encountered error while trying to execute `'+ hCall +'`' + err.stack || err);
        }

        self.process(bindings, len, i+1)
    }


    return self
}
// Publish as AMD module
define( 'helpers/binding',[],function() { return BindingHelper });
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
define('gina/popin', [ 'require', 'jquery', 'vendor/uuid','utils/merge', 'utils/routing', 'utils/events' ], function (require) {

    var $       = require('jquery');
    $.noConflict();
    var uuid    = require('vendor/uuid');
    var merge   = require('utils/merge');
    var routing = require('utils/routing');

    require('utils/events'); // events

    /**
     * Gina Popin Handler
     *
     * @param {object} options
     * */
    function Popin(options) {

        this.plugin = 'popin';

        var events  = ['init', 'loaded', 'ready', 'open', 'close', 'click', 'destroy', 'success', 'error', 'progress'];
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
            'isRedirecting'     : false,
            'close'             : null,
            '$forms'            : [],
            'hasForm'           : false,
            '$headers'             : [] // head elements for this popin
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
            //if ( )
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

            if (!$popin && gina.popin.activePopinId) {
                $popin = gina.popin.$popins[gina.popin.activePopinId]
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
                    if (url == '' || url =='#' || /\#/.test(url) ) {
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
                            addListener(gina, $popin.target, 'loaded.'+$popin.id, function(e) {
                                e.preventDefault();

                                if (!fired) {
                                    fired = true;
                                    console.debug('active popin should be ', $popin.id);
                                    gina.popin.activePopinId = $popin.id;
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
                                withCredentials: false // by default
                            };
                            options = merge($popin.options, options);
                            var url = this.getAttribute('data-gina-popin-url') || this.getAttribute('href');
                            if (!url) {
                                throw new Error('Popin `url` not defined, please check value for `data-gina-popin-url`');
                            }
                            popinLoad($popin.name, url, options);
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

                if ( event.target.getAttribute('disabled') != null && event.target.getAttribute('disabled') != 'false' ) {
                    return false;
                }

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

            if (
                typeof(e.detail) != 'undefined'
                && typeof(e.detail.trim) == 'function'
            ) {
                $el.innerHTML = e.detail.trim();
            }


            var register = function (type, evt, $element) {
                var isLink = $element.getAttribute('data-gina-popin-is-link');
                isLink = ( /^true$/i.test(isLink) ) ? true : false;
                if ( type == 'link' && !isLink) {
                    // like a form action, so gina will not follow the href and the event will be prevented
                    type = 'action';
                }
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
                    // ignore disabled
                    if ( event.target.getAttribute('disabled') != null && event.target.getAttribute('disabled') != 'false' ) {
                        return false;
                    }
                    // NB.: `type == 'action'` will be handled by the form validator
                    if ( type == 'link' ) {
                        //console.debug('This is a link', event.target);
                        var linkTarget = event.target.getAttribute('target');
                        if ( linkTarget != null && linkTarget != '' ) {
                            var _window = window.open(linkHref, event.target.getAttribute('target'));
                            // _window.onload = function onWindowLoad() {
                            //     var $popin = getActivePopin();
                            //     triggerEvent(gina, $popin, 'loaded.' + id);
                            // }
                        } else { // else, inside viewbox
                            // TODO - Integrate https://github.com/box/viewer.js#loading-a-simple-viewer
                            triggerEvent(gina, event.target, event.currentTarget.id, $popin);
                        }

                    } /**else if ( type == 'action' ) {
                        // rewrite form attributes
                        //console.debug('This is an action ', event.target);
                    }*/ else { // close

                        if ( typeof(event.target.id) == 'undefined' ) {
                            event.target.setAttribute('id', evt +'.'+ uuid.v4() );
                            event.target.id = event.target.getAttribute('id')
                        }

                        if ( /^popin\.close\./.test(event.target.id) ) {
                            cancelEvent(event);
                            // Just in case we left the popin with a link:target = _blank
                            $popin.isRedirecting = false;
                            popinClose($popin.name);
                        }

                        if ( /^popin\.click\./.test(event.target.id) ) {
                            cancelEvent(event);
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
                addListener(gina, $overlay, 'mousedown', function(event) {

                    // don't cancel here, it will corrupt child elements behaviors such as checkboxes and radio buttons
                    if ( /gina-popin-is-active/.test(event.target.className) ) {

                        // remove listeners
                        removeListener(gina, event.target, 'mousedown');

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
                                    ++i;
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
                            let $el = $close[b];
                            let eId = $el.getAttribute('id');
                            for (let e = 0, eLen = events.length; e < eLen; e++) {
                                let evt = events[e];
                                if ( typeof(gina.events[ evt ]) != 'undefined' && gina.events[ evt ] == eId ) {
                                    removeListener(gina, $el, evt);
                                }
                                if ( typeof(gina.events[ eId ]) != 'undefined' && gina.events[ eId ] == eId ) {
                                    removeListener(gina, $el, eId);
                                }

                                if ( typeof(gina.events[ evt +'.'+ eId ]) != 'undefined' && gina.events[ evt +'.'+ eId ] == eId ) {
                                    removeListener(gina, $el, evt +'.'+ eId);
                                }

                                if ( typeof(gina.events[ evt +'.'+ eId ]) != 'undefined' && gina.events[ evt +'.'+ eId ] == evt +'.'+ eId ) {
                                    removeListener(gina, $el, evt +'.'+ eId);
                                }
                            }


                            //removeListener(gina, $close[b], $close[b].getAttribute('id') );
                        }

                        // div with click
                        // var $elTMP = $form.target.getElementsByTagName('div');
                        // if ( $elTMP.length > 0 ) {
                        //     for(let i = 0, len = $elTMP.length; i < len; ++i) {
                        //         $els.push( $elTMP[i] )
                        //     }
                        // }
                        // // label with click
                        // $elTMP = $form.target.getElementsByTagName('label');
                        // if ( $elTMP.length > 0 ) {
                        //     for(let i = 0, len = $elTMP.length; i < len; ++i) {
                        //         $els.push( $elTMP[i] )
                        //     }
                        // }

                        // Just in case we left the popin with a link:target = _blank
                        $popin.isRedirecting = false;
                        popinClose($popin.name);
                    }

                });
            }
            // detecting form in popin
            if ( /<form/i.test($el.innerHTML) && typeof($validatorInstance) != 'undefined' && $validatorInstance ) {
                $popin.hasForm = true;
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
                        // ignore href already bindded byr formValidator or the user
                        && !$buttonsTMP[b].id
                        ||
                        typeof($buttonsTMP[b]) != 'undefined'
                        && !/(\#|\#.*)$/.test($buttonsTMP[b].href) // ignore href="#"
                        && !/^(click\.|popin\.link)/.test($buttonsTMP[b].id)
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
            var _form = null, f = null, fLen = null;
            var inheritedData = {}, _formData = null;
            var domParserObject = new DOMParser()
                , currentId     = null
                , found         = null
                , aHref         = null
                , isSubmitLink  = null
                , isLink        = null
            ;

            for (; i < len; ++i) {
                // if is disabled, stop propagation
                if ( $link[i].getAttribute('disabled') != null ) {
                    continue;
                }

                $link[i]['id'] =  ( /^null$/i.test($link[i].getAttribute('id')) ) ? null : $link[i].getAttribute('id');
                if (!$link[i]['id'] || !/^popin\.link/.test($link[i]['id']) || !/^popin\.click/.test($link[i]['id']) ) {

                    // just in case
                    isLink = true;
                    aHref = $link[i].getAttribute('href');
                    if (!aHref || aHref == '' || aHref == '#' ) {
                        if (aHref != '#')
                            $link[i].setAttribute('href', '#');
                        isLink = false;
                    }
                    // link or action ?
                    if (/^null$/i.test($link[i]['id'])) {
                        if ( isLink ) {
                            evt = 'popin.link.' + uuid.v4();
                            $link[i].setAttribute('data-gina-popin-is-link', true);
                        } else {
                            evt = 'popin.click.' + uuid.v4();
                            $link[i].setAttribute('data-gina-popin-is-link', false);
                        }
                    } else {
                        evt = $link[i]['id'];
                    }

                    $link[i]['id'] = evt;
                    $link[i].setAttribute( 'id', evt);

                } else {
                    evt = $link[i]['id'];
                }

                // ignore `isSubmitLink == true`
                // will be handled by validator
                isSubmitLink = $link[i].getAttribute('data-gina-form-submit');
                isSubmitLink = ( isSubmitLink && /^true$/i.test(isSubmitLink) ) ? true : false;
                if (isSubmitLink) {
                    continue;
                }


                if ( !/^(null|\s*)$/.test($link[i].getAttribute('href')) ) {
                    addListener(gina, $link[i], 'click', function(linkEvent) {
                        linkEvent.preventDefault();

                        $popin.isRedirecting = true;

                        if ($popin.hasForm) {
                            // Experimental - inheritedData
                            // Inhertitance from previously request: merging datas with current form context
                            // TODO - Get the inhereted data from LMDB Database using the form CSRF
                            _form = $popin.target.getElementsByTagName('FORM');
                            f = 0; fLen = _form.length;
                            for (; f < fLen; ++f) {
                                // check if current link is in form
                                currentId = linkEvent.currentTarget.id;
                                found = domParserObject.parseFromString(_form.item(f).innerHTML, 'text/html').getElementById(currentId) || false;
                                if ( found ) {
                                    _formData = _form[f].getAttribute('data-gina-form-inherits-data') || null;
                                    // mergin GET data
                                    inheritedData = merge(inheritedData, JSON.parse(decodeURIComponent(_formData)));
                                }
                            }

                            // has already params ?
                            if ( inheritedData.count() > 0 ) {
                                if ( /\?/.test(linkEvent.currentTarget.href) ) {
                                    linkEvent.currentTarget.href += '&inheritedData=' + encodeURIComponent(JSON.stringify(inheritedData));
                                } else {
                                    linkEvent.currentTarget.href += '?inheritedData=' + encodeURIComponent(JSON.stringify(inheritedData));
                                }
                            }
                        }
                    })
                }

                if ( typeof(gina.events[evt]) == 'undefined' || gina.events[evt] != $link[i].id ) {
                    register('link', evt, $link[i])
                }


            } // EO for(; i < len; ++i)

            // bind with formValidator if forms are found
            if ($popin.hasForm) {
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

                    //console.debug('pushing ', _id, $forms[i]['id'], typeof($forms[i]['id']), $forms[i].getAttribute('id'));
                    if ($popin['$forms'].indexOf(_id) < 0)
                        $popin['$forms'].push(_id);

                    $forms[i].close = popinClose;
                    $validatorInstance.isPopinContext = true;
                    $validatorInstance.validateFormById($forms[i].getAttribute('id')); //$forms[i]['id']

                    removeListener(gina, $popin.target, eventType);
                }
            }

        }

        function updateToolbar(result, resultIsObject) {
            // update toolbar errors
            var $popin = getActivePopin();

            if ( gina && typeof(window.ginaToolbar) != 'undefined' && window.ginaToolbar && typeof(result) != 'undefined' && typeof(resultIsObject) != 'undefined' && result ) {

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

            if ( gina && typeof(window.ginaToolbar) != 'undefined' && window.ginaToolbar && XHRData ) {
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

            if ( gina && typeof(window.ginaToolbar) != 'undefined' && window.ginaToolbar && XHRView ) {
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
            // if no name defiend, get the current
            if ( typeof(name) == 'undefined' ) {
                if ( typeof(this.name) == 'undefined' ) {
                    throw new Error('`$popin.name` needs to be defined !')
                }
                name = this.name;
            } else if (typeof(this.name) == 'undefined' && name != 'undefined') {
                this.name = name;
            }
            // popin object
            var $popin      = getPopinByName(name);
            var id          = $popin.id;

            // set as active if none is active
            if ( !gina.popin.activePopinId ) {
                gina.popin.activePopinId = id;
            }

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
                // In order to inherit without overriding default xhrOptions
                var isWithCredentials = xhrOptions.withCredentials;
                options = merge(options, xhrOptions);

                options.withCredentials = isWithCredentials;
            }

            if (
                /^(http|https)\:/.test(url)
                && !new RegExp('^' + window.location.protocol + '//'+ window.location.host).test(url)
            ) {
                // is request from same domain ?
                //options.headers['Origin']   = window.protocol+'//'+window.location.host;
                //options.headers['Origin']   = '*';
                //options.headers['Host']     = 'https://domain.local:3154';
                var isSameDomain = ( new RegExp(window.location.hostname).test(url) ) ? true : false;
                if (!isSameDomain) {
                    // proxy external urls
                    // TODO - instead of using `cors.io` or similar services, try to intégrate a local CORS proxy similar to : http://oskarhane.com/avoid-cors-with-nginx-proxy_pass/
                    //url = url.match(/^(https|http)\:/)[0] + '//cors.io/?' + url;
                    url = url.match(/^(https|http)\:/)[0] + '//corsacme.herokuapp.com/?'+ url;
                    //url = url.match(/^(https|http)\:/)[0] + '//cors-anywhere.herokuapp.com/' + url;

                    //delete options.headers['X-Requested-With']

                    // remove credentials on untrusted env
                    // if forced by user options, it will be restored with $popin.options merge
                    options.withCredentials = false;
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
                    instance.eventData.error = result +'\n'+ err;
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
                                var result          = xhr.responseText
                                    , contentType   = xhr.getResponseHeader("Content-Type")
                                    , isJsonContent = (/application\/json/.test( contentType )) ? true : false
                                    , isRedirecting = true // by default
                                ;
                                if ( isJsonContent ) {
                                    result = JSON.parse(xhr.responseText);
                                    result.status = xhr.status;
                                    result.contentType = contentType;
                                    isRedirecting = false;
                                }


                                instance.eventData.success = result;

                                if (
                                    !isJsonContent && $popin.isOpen && !$popin.hasForm
                                    ||
                                    !isJsonContent && $popin.isOpen && isRedirecting
                                ) {
                                    popinLoadContent(result, isRedirecting);
                                } else {

                                    if (
                                        isJsonContent && typeof(result.location) != 'undefined'
                                        ||
                                        isJsonContent && typeof(result.reload) != 'undefined'
                                    ) {
                                        var isXhrRedirect = false;
                                        if (
                                            typeof(result.isXhrRedirect) != 'undefined'
                                            && /^true$/i.test(result.isXhrRedirect)
                                        ) {
                                            isXhrRedirect = true;
                                        }
                                        if ( typeof(result.location) != 'undefined' && isXhrRedirect ) {

                                            if (
                                                typeof(result.popin) != 'undefined'
                                                && typeof(result.popin.close) != 'undefined'
                                            ) {
                                                $popin.isRedirecting = false;
                                                $popin.close();

                                                var _reload = (result.popin.reload) ? result.popin.reload : false;
                                                if ( !result.popin.location && !result.popin.url) {
                                                    delete result.popin;
                                                    // only exception
                                                    if (_reload) {
                                                        result.popin = { reload: _reload };
                                                    }
                                                }
                                            }

                                            var _target = '_self'; // by default
                                            if ( typeof(result.target) != 'undefined' ) {
                                                if ( /^(blank|self|parent|top)$/ ) {
                                                    result.target = '_'+result.target;
                                                }
                                                _target = result.target
                                            }

                                            // special case of location without having the popin open
                                            // can occure while tunnelling
                                            if ( /^_self$/.test(_target) ) {
                                                var popinUrl = null;
                                                if ( typeof(result.popin) != 'undefined' ) {
                                                    popinUrl = result.popin.location || result.popin.url;
                                                } else {
                                                    popinUrl = result.location;
                                                }

                                                $popin
                                                    .load( $popin.name, popinUrl, $popin.options );
                                                return setTimeout( function onPopinredirect($popin){
                                                    if (!$popin.isOpen) {
                                                        $popin.open();
                                                        return;
                                                    }
                                                }, 50, $popin);
                                            }


                                            window.open(result.location, _target);
                                            return;
                                        }

                                        if ( typeof(result.location) != 'undefined' ) {
                                            document.location = result.location;
                                            return;
                                        }

                                        if ( typeof(result.reload) != 'undefined' ) {
                                            document.location.reload();
                                            return;
                                        }

                                        if ( typeof(result.popin) != 'undefined' ) {
                                            if ( typeof(result.popin.close) != 'undefined' ) {
                                                $popin.isRedirecting = false;
                                                popinClose($popin.name);
                                            }
                                        }
                                    }

                                    //if ( !isJsonContent && $popin.hasForm) {
                                        //$validatorInstance.handleXhrResponse(xhr, $forms[0], $forms[0].id, event, true);
                                        //handleXhr(xhr, $el, options, require)
                                        //return
                                    //}
                                    if ( !isJsonContent ) {
                                        triggerEvent(gina, $el, 'loaded.' + id, result);
                                        return
                                    }

                                    triggerEvent(gina, $forms[0], 'success.' + id, result);

                                }

                                if (GINA_ENV_IS_DEV)
                                    updateToolbar(result);

                            } catch (err) {

                                var resultIsObject = false;

                                var result = {
                                    'status':  422,
                                    'error' : err.description || err.stack
                                };

                                if ( /application\/json/.test( xhr.getResponseHeader("Content-Type") ) ) {
                                    result.error = JSON.parse(xhr.responseText);
                                    resultIsObject = true
                                }

                                instance.eventData.error = result;
                                if (GINA_ENV_IS_DEV)
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

                            if ( /application\/json/.test( xhr.getResponseHeader("Content-Type") ) ) {
                                result.error = JSON.parse(xhr.responseText);
                                resultIsObject = true
                            }

                            instance.eventData.error = result;


                            // update toolbar
                            if (GINA_ENV_IS_DEV)
                                updateToolbar(result, resultIsObject);

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
         * @param {boolean} [isRedirecting] - to handle link inside popin without form
         */
        function popinLoadContent(stringContent, isRedirecting) {

            var $popin = getActivePopin();
            if ( !$popin ) {
                return;
            }
            if (!$popin.isOpen)
                throw new Error('Popin `'+$popin.name+'` is not open !');

            $popin.isRedirecting = ( typeof(isRedirecting) != 'undefined' ) ? isRedirecting : false;

            var $el = $popin.target;
            // if (
            //     typeof(stringContent) != 'undefined'
            //     && typeof(stringContent.trim) == 'function'
            // ) {
                $el.innerHTML = stringContent.trim();
            // }

            popinUnbind($popin.name, true);
            popinBind({ target: $el, type: 'loaded.' + $popin.id }, $popin);

            if ( !$popin.isRedirecting ) {
                triggerEvent(gina, instance.target, 'open.'+ $popin.id, $popin);
            } else {
                triggerEvent(gina, instance.target, 'loaded.' + $popin.id, $popin);
            }
        }

        function getScript(source) {
            // then trigger scripts load
            //var xhr = new XMLHttpRequest();
            var xhr = setupXhr();
            xhr.open('GET', source, true);
            xhr.setRequestHeader("Content-Type", "text/javascript");
            xhr.onload = function () {
                eval(xhr.response);
            };
            xhr.send();
        }

        /**
         * popinOpen
         *
         * If you get a x-origin error, check if you have `Vary` rule
         * set in your policy : // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Vary
         *
         * Add to your project/env.json the following rule
         * {
         *  "$bundle" : {
         *      "server": {
         *          "response": {
         *              // other definitions ...
         *
         *              "vary": "Origin"
         *          }
         *      }
         *  }
         * }
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

            // load external resources in order of declaration
            // TODO - Add support for stylesheets
            var globalScriptsList   = $popin.parentScripts
                , scripts           = $el.getElementsByTagName('script')
                //, globalStylesList  = $popin.parentStyles
                , i                 = 0
                , len               = scripts.length
            ;
            var domain = gina.config.hostname.replace(/(https|http|)\:\/\//, '').replace(/\:\d+$/, '');
            var reDomain = new RegExp(domain+'\:\\d+\|'+domain);
            for (;i < len; ++i) {
                if ( typeof(scripts[i].src) == 'undefined' || scripts[i].src == '' ) {
                    continue;
                }
                let filename = scripts[i].src
                                .replace(/(https|http|)\:\/\//, '')
                                .replace(reDomain, '');
                // don't load if already in the global context
                if ( globalScriptsList.indexOf(filename) > -1 )
                    continue;

                getScript(scripts[i].src);
            }
            //i = 0; len = styles.length

            popinBind({ target: $el, type: 'loaded.' + $popin.id }, $popin);


            if ( !/gina-popin-is-active/.test($el.className) )
                $el.className += ' gina-popin-is-active';

            // overlay
            if ( !/gina-popin-is-active/.test(instance.target.firstChild.className) )
                instance.target.firstChild.className += ' gina-popin-is-active';
            // overlay
            if ( /gina-popin-is-active/.test(instance.target.firstChild.className) ) {
                removeListener(gina, instance.target, 'open.'+ $popin.id)
            }

            $popin.isOpen = true;
            // so it can be forwarded to the handler who is listening
            $popin.target = $el;

            instance.activePopinId = $popin.id;

            // update toolbar
            if (GINA_ENV_IS_DEV)
                updateToolbar();
            // var XHRData = document.getElementById('gina-without-layout-xhr-data');
            // if ( gina && typeof(window.ginaToolbar) != 'undefined' && window.ginaToolbar && XHRData ) {
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
            // if ( gina && typeof(window.ginaToolbar) != 'undefined' && window.ginaToolbar && XHRView ) {
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

            var $popin = null;
            if ( typeof(name) == 'undefined' && /^true$/.test(this.isOpen) ) {
                name    = this.name;
                $popin  = this;
            } else {
                $popin  = getPopinByName(name) || getActivePopin();
                if (!$popin)
                    return;

                name    = $popin.name;
            }
            //var $popin = ( typeof(name) != 'undefined') ? getPopinByName(name) : getActivePopin();
            var $el = null;
            if ( !$popin && typeof(name) != 'undefined' ) {
               throw new Error('Popin `'+name+'` not found !');
            }
            if (!$popin.isOpen)
                return;

            // by default
            if ( typeof($popin) != 'undefined' && $popin != null ) {

                // in case popinClose is called by the user e.g.: binding cancel/close with a <A> tag
                // but at the same time, the <A> href is not empty -> redirection wanted in the HTML
                // in this case, we want to ignore close
                if ( $popin.isRedirecting )
                    return;

                $el = $popin.target;

                removeListener(gina, $popin.target, 'ready.' + instance.id);

                if ( $popin.hasForm ) {
                    $popin.hasForm = false;
                }

                if ( $el != null && /gina-popin-is-active/.test($el.className) ) {

                    popinUnbind(name);
                    $popin.isOpen           = false;
                    gina.popinIsBinded      = false;

                    // restore toolbar
                    if ( GINA_ENV_IS_DEV && gina &&  typeof(window.ginaToolbar) != 'undefined' && window.ginaToolbar )
                        ginaToolbar.restore();

                    instance.activePopinId  = null;
                    if ( $popin.$headers.length > 0) {
                        var s = 0
                            , sLen = $popin.$headers.length
                        ;
                        try {
                            for (; s<sLen; ++s) {
                                document.getElementById( $popin.$headers[s].id ).remove();
                            }
                        } catch(err){
                            console.warn('Could not remove script `'+ $popin.$headers[s].id +'`\n'+ err.stack)
                        }
                        $popin.$headers = [];
                    }
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
                if (GINA_ENV_IS_DEV)
                    $popin.updateToolbar    = updateToolbar;

                // Get main resources
                $popin.parentScripts    = [];
                $popin.parentStyles     = [];
                var domain = gina.config.hostname.replace(/(https|http|)\:\/\//, '').replace(/\:\d+$/, '');
                var reDomain = new RegExp(domain+'\:\\d+\|'+domain);
                // Parent scripts
                var mainDocumentScripts = document.getElementsByTagName('script');
                for (let s = 0, len = mainDocumentScripts.length; s < len; s++ ) {
                    if (!mainDocumentScripts[s].src || mainDocumentScripts[s].src == '')
                        continue;
                    // Filename without domain
                    let filename = mainDocumentScripts[s].src
                                    .replace(/(https|http|)\:\/\//, '')
                                    .replace(reDomain, '');
                    $popin.parentScripts[s] = filename;
                }
                // Parent Styles
                var mainDocumentStyles  = document.getElementsByTagName('link');
                for (let s = 0, len = mainDocumentStyles.length; s < len; s++ ) {
                    if ( typeof(mainDocumentStyles[s].rel) == 'undefined' || !/stylesheet/i.test(mainDocumentStyles[s].rel) )
                        continue;
                    // Filename without domain
                    let filename = mainDocumentStyles[s].href
                                    .replace(/(https|http|)\:\/\//, '')
                                    .replace(reDomain, '');
                    $popin.parentStyles[s] = filename;
                }



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
            //instance.on('init', function(event) {
            addListener(gina, instance.target, 'init.'+instance.id, function(e) {

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
            instance.getPopinById   = getPopinById;
            instance.getPopinByName = getPopinByName;
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
 * Operations on element
 * - animations
 * */
function fadeIn(element) {
    var op = 0.1;  // initial opacity
    element.style.display = 'block';
    var timer = setInterval(function () {
        if (op >= 1){
            clearInterval(timer);
        }
        element.style.opacity = op;
        element.style.filter = 'alpha(opacity=' + op * 100 + ")";
        op += op * 0.1;
    }, 10);
}

function fadeOut(element) {
    var op = 1;  // initial opacity
    var timer = setInterval(function () {
        if (op <= 0.1){
            clearInterval(timer);
            element.style.display = 'none';
        }
        element.style.opacity = op;
        element.style.filter = 'alpha(opacity=' + op * 100 + ")";
        op -= op * 0.1;
    }, 50);
}
;
define("utils/effects", function(){});

/**
 * Object.assign
 * Ref.: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/assign
 *
 */
if (typeof Object.assign !== 'function') {
    // Must be writable: true, enumerable: false, configurable: true
    Object.defineProperty(Object, "assign", {
        value: function assign(target, varArgs) { // .length of function is 2
            'use strict';
            if (target === null || target === undefined) {
                throw new TypeError('Cannot convert undefined or null to object');
            }

            var to = Object(target);
            for (var index = 1; index < arguments.length; index++) {
                var nextSource = arguments[index];

                if (nextSource !== null && nextSource !== undefined) {
                for (var nextKey in nextSource) {
                    // Avoid bugs when hasOwnProperty is shadowed
                    if (Object.prototype.hasOwnProperty.call(nextSource, nextKey)) {
                    to[nextKey] = nextSource[nextKey];
                    }
                }
                }
            }
            return to;
        },
        writable: true,
        configurable: true
    });
}

if ( typeof(JSON.clone) == 'undefined' ) {
    /**
     * JSON.clone
     * Clone JSON object
     *
     * Changes made here must be reflected in:
     *  - gina/utils/prototypes.js
     *  - gina/framework/version/helpers/prototypes.js
     *  - gina/framework/version/core/asset/plugin/src/gina/utils/polyfill.js
     *
     * @param {object} source
     * @param {object} [target]
     *
     * @returns {object} cloned JSON object
     **/
    var clone = function(source, target) {
        if (source == null || typeof source != 'object') return source;
        if (source.constructor != Object && source.constructor != Array) return source;
        if (source.constructor == Date || source.constructor == RegExp || source.constructor == Function ||
            source.constructor == String || source.constructor == Number || source.constructor == Boolean)
            return new source.constructor(source);

        target = target || new source.constructor();
        var i       = 0
            , len   = Object.getOwnPropertyNames(source).length || 0
            , keys  = Object.keys(source)
        ;

        while (i<len) {
            target[keys[i]] = (typeof target[keys[i]] == 'undefined') ? clone(source[keys[i]], null) : target[keys[i]];
            i++;
        }
        i = null; len = null; keys = null;

        return target;
    };

    JSON.clone = clone;
    // WHY NOT USE SOMETHING ELSE ?
    // Could have been fine, but not working when you have references pointg to another object
    // return Object.assign({}, source);

    // Performences issue
    //return JSON.parse(JSON.stringify(source));
}

if ( typeof(JSON.escape) == 'undefined' ) {
    /**
     * JSON.escape
     * Escape special characters
     *
     * Changes made here must be reflected in:
     *  - gina/utils/prototypes.js
     *  - gina/framework/version/helpers/prototypes.js
     *  - gina/framework/version/core/asset/plugin/src/gina/utils/polyfill.js
     *
     * @param {object} jsonStr
     *
     * @returns {object} escaped JSON string
     **/
     var escape = function(jsonStr){
        try {
            return jsonStr
                       .replace(/\n/g, "\\n")
                       .replace(/\r/g, "\\r")
                       .replace(/\t/g, "\\t")
                   ;
        } catch (err) {
           throw err;
        }
    };

    JSON.escape = escape;
};
define("utils/polyfill", function(){});


/**
 * This file is part of the gina package.
 * Copyright (c) 2009-2023 Rhinostone <contact@gina.io>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

/**
 * @class Inherits
 *
 * @package gina.utils
 * @namesame gina.utils.inherits
 * @author Rhinostone <contact@gina.io>
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
                                if (!this[prop]) {
                                    this[prop] = b.prototype[prop];
                                }
                            }

                            b.apply(this, arguments);
                            cache.apply(this, arguments);
                        }
                    };
                }

            }(a, b));

            //makes it compatible with node.js classes like EventEmitter
            if (a.prototype == undefined) {
                a.prototype = {};
            }

            if (b.prototype == undefined) {
                b.prototype = {};
            }

            a.prototype = Object.create(b.prototype, {});
            z.prototype = Object.create(a.prototype, {}); //{ name: { writable: true, configurable: true, value: name }

            return z;
        } else {
            throw new Error(err);
        }
    };

    var check = function(a, b) {
        if ( typeof(a) == 'undefined' || typeof(b) == 'undefined') {
            return 'inherits(a, b): neither [ a ] nor [ b ] can\'t be undefined or null'
        }
        return false;
    };

    return init;
}


if ( ( typeof(module) !== 'undefined' ) && module.exports ) {
    // Publish as node.js module
    module.exports = Inherits();
} else if ( typeof(define) === 'function' && define.amd) {
    // Publish as AMD module
    define( 'utils/inherits',[],function() { return Inherits(); });
};
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
 *      This can be achieved by overriding `window['originalContext']` before defining your handler
 *       Default value will be jQuery
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
                            if ( typeof(readyList) == 'undefined' ) {
                                // Fixing init bug in chrome
                                readyList = window.readyList;
                            }
                            readyList[i].ctx = window.gina;
                            result = readyList[i].fn.call(window, readyList[i].ctx, window.require);

                            // clear
                            if (result) {
                                window.clearInterval(scheduler);
                                ++i;
                                handleEvent(i, readyList);
                            }
                        } catch (err) {
                            window.clearInterval(scheduler);
                            throw err;
                        }

                    }, 50, i, readyList);


                } else { // onEachHandlerReady
                    // iframe case
                    if ( !window.$ && typeof(parent.window.$) != 'undefined' ) {
                        window.$ = parent.window.$;
                    }
                    // by default, but can be overriden in your handler (before the handler definition)
                    if ( typeof(window.originalContext) == 'undefined' && typeof(window.$) != 'undefined' ) {
                        window.originalContext = window.$
                    }
                    readyList[i].ctx = window.originalContext || $;// passes the user's orignalContext by default; if no orignalContext is set will try users'jQuery
                    readyList[i].fn.call(window, readyList[i].ctx, window.require);
                    ++i;
                    handleEvent(i, readyList);
                }

            } else { // end
                // allow any closures held by these functions to free
                readyList = [];
            }
        }

        handleEvent(i, readyList);
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
         * `_global` is used mainly for google closure compilation in some cases
         * where eval() is called
         * It will store extenal variable definitions
         * e.g.:
         *  root -> window.root
         *  then you need to call :
         *      gina._global.register({'root': yourValue });
         *      => `window.root`now accessible
         *  before using:
         *      eval(root +'=value');
         *
         *  when not required anymore
         *      gina._global.unregister(['root])
         */
        /**@js_externs _global*/
        _global: {

            /**@js_externs register*/
            register: function(variables) {
                if ( typeof(variables) != 'undefined') {
                    for (let k in variables) {
                        // if ( typeof(window[k]) != 'undefined' ) {
                        //     // already register
                        //     continue;
                        //     //throw new Error('Gina cannot register _global.'+k+': variable name need to be changed, or you need to called `_global.unregister(['+k+'])` in order to use it');
                        // }
                        //window.gina['_global'][k] = variables[k];
                        window[k] = variables[k];
                    }
                }
            },
            /**@js_externs unregister*/
            unregister: function(variables) {
                if ( typeof(variables) == 'undefined' || !Array.isArray(variables)) {
                    throw new Error('`variables` needs to ba an array')
                }

                for (let i = 0, len = variables.length; i < len; i++) {
                    //delete  window.gina['_global'][ variables[i] ];
                    //if ( typeof(window[ variables[i] ]) != 'undefined' ) {
                        //console.debug('now removing: '+ variables[i]);
                        delete window[ variables[i] ]
                    //}
                }
            }
        },
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

// exporting
require([
    //vendors
    "vendor/uuid",
    "vendor/engine.io",

    "core",
    // helpers
    "helpers/prototypes",
    "helpers/binding",
    "helpers/dateFormat",

    // plugins
    "gina/link",
    "gina/validator",
    "gina/popin",
    "gina/storage",

    // utils
    "utils/dom",
    "utils/events",
    "utils/effects",
    "utils/polyfill",
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
                        window['GINA_ENV_IS_DEV']   = /^true$/i.test('{{ GINA_ENV_IS_DEV }}') ? true : false;
                        if ( typeof(location.search) != 'undefined' && /debug\=/i.test(window.location.search) ) {
                            window['GINA_ENV_IS_DEV'] = gina['config']['envIsDev'] = options['envIsDev'] = /^true$/i.test(window.location.search.match(/debug=(true|false)/)[0].split(/\=/)[1]) ? true: false;
                        }

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
