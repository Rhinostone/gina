# Gina

<strong>Gina I/O</strong> - Node.js MVC and Event Driven framework

> This is a `preview version`. We are looking for people to help us test and imrpove `Windows` support.

## Philosophy behind

Gina was designed to be accessible, flexible, scalable and maintainable. Our main purpose was to allow developpers to create easier and faster web applications.

Gina comes with essential features at this moment, but most of the things we don't have yet can be replaced by some alternatives written in other languages like: Ruby, PHP, .net, Python or C++. You are free to use such alternatives until we implement similar features.

## Getting started with Gina I/O

### Installing Gina
Gina is at the same time a framework, a deploy and monitoring environnement for your projects. To fully enjoy Gina, we recommend that you install it with the `-g` option.

```  tty
npm install -g gina@latest
```

You can check if gina is properly installed
```  tty
gina version
```
NB.: This is a shortcut for `gina framework:version`

If you need any help, hit :

```  tty
gina framework:help
```

### Initializing a project
Let's create our first project and install gina.

``` tty
mkdir myproject
```

``` tty
cd myproject
```

Then you need to __initialize your project__

> on Windows from the Windows CLI - __NEED TO BE ADMIN !!__

```  tty
gina project:add myproject
```


__NB:__ If you have not installed gina with the global option, make sure that all gina commands are launched from the project root.

### Creating a bundle (application)

A project is a set of bundles. Gina lets you create all kind of bundles :
* api & webservices
* frontend & backend applications
* command lines

Note that the default bundle type is api.

Ok ! Let's do it !

``` tty
gina bundle:add frontend @myproject
```
__NB.:__ If you are launching the command from the project root, you don't need `@myproject`. The same goes for all bundle commands.

We have just created a frontend application that will host our homepage.
You will find all bundle sources under `myproject/src`.

You can start the bundle with the following command:

```tty
gina bundle:start frontend @myproject
```


Now, visite http://127.0.0.1:3100/  to check your homepage.
Isn't it sexy !?

If you need to stop your bundle
```tty
gina bundle:stop frontend @myproject
```

If you need to restart you bundle
```tty
gina bundle:restart frontend @myproject
```

### Setting environment
__Setting default env__
By default, Gina is intalled with `dev` environment which allow you to display the toolbar.
If you need to change this:
```tty
gina framework:set --env=prod
```
This only means that when you omit the env in the command line, it will automatically add `--env=prod` for you.

> __NB:__ You can pick any name you want.

__Setting starting env__
You can have multiple environments for your project and decide to pick one as the starting env by using `--env=your_env` everytime you have to run a bundle.

```tty
gina bundle:start frontend @myproject --env=prod
```


### Adding views

The default bundle renders a json representation of a "Hello World" message.

Let's add views on our frontend

```tty
gina bundle:add-views frontend @myproject
```
Now edit the `init` control in `src/frontend/controllers/controller.js` so that you can have `self.render(...)` instead of `self.renderJSON(...)`

Once it's done, you just need to refresh your browser.

Gina is shipped with [Swig](https://node-swig.github.io/swig-templates/) as the default template engine. If you are more confortable with another template engine, you can use your own.


## Troubleshooting

### I can't start my bundle

__Are you starting for the first time ?__

- If you are a __Windows user__, make sure you are running your command line with sufficient permission; like __"launching your terminal as administrator"__.


- If you have just cloned Gina from github, don't forget to run from the project root :
```tty
node node_modules/gina/script/post_install.js
```

- Have you noticed the __environment argument__ ( dev ) ?
``` tty
gina bundle:start frontend --env=dev
```
Without the __dev__ argument, Gina is going to understand that you want to use the default environment (prod by default). If it's really what you want to achieve, just __build__ without `--env=prod`:
```tty
gina bundle:build frontend --env=prod
```


__Are you trying to restart after a crash ?__

Before v0.1.0, Gina uses 2 processes for each bundle: one master, one slave.
Once an excepion is thrown and the program crashes, one of the 2 process can remain in the tasks/processes list.

Gina only uses one process per bundle or one per project if you heve decided to merge bundles execution.
This has been mostly observed for Windows users.

- If you are on a POSIX OS, you should look for `gina`, then kill it !

- If you are on a Windows, look for `node.exe` or  `Event I/O Handler`, then kill it !

After this, try again to start, it should run better.




More documentation and tutorials are coming !


## License (MIT)

Copyright (c) 2009-2022 [Rhinostone](http://www.rhinostone.com/)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is furnished
to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.