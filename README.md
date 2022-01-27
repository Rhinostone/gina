# Gina

<strong>Gina I/O</strong> - Node.js MVC and Event Driven framework

> This is a `preview release`. We are looking for people to help us test and improve `Windows` support.
> Some commands or features might not work since the framework is still in developpement & testing
> We have some applications using the framework in production and we are still improving our code in order to release the `1.0.0` version: which should come by the end of 2022.

## Philosophy behind

Gina was designed to be accessible, flexible, scalable and maintainable. Our main purpose was to allow developpers to create easier and faster web applications.

Gina comes with essential features at this moment, but most of the things we don't have yet can be replaced by some alternatives written in other languages like: Ruby, PHP, .net, Python or C++. You are free to use such alternatives until we implement similar features.

## Getting started with Gina I/O

### Installing Gina
Gina aims to be at the same time a framework, a deploy and monitoring environnement for your projects. To fully enjoy Gina, we recommend that you install it with the `-g` option.

```  tty
npm install -g gina@latest
```

You can check if gina is properly installed
```  tty
gina version
```
__NB.:__ This is a shortcut for `gina framework:version`


### Initializing a project
Let's create our first project and install gina.

``` tty
mkdir myproject && cd myproject
```


Then you need to __initialize your project__

> on Windows from the Windows CLI, you might need admin privilegies.

```  tty
gina project:add @myproject
```

If you need to remove this project later
```  tty
gina project:rm @myproject
```

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
__NB.:__ If you are launching the command from the project directory, you don't need `@myproject`. The same goes for all bundles commands.

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

### Adding templates

The default bundle renders a json representation of a "Hello World" message.

Let's add a view on our frontend

```tty
gina view:add frontend @myproject
```
Now edit the `home` control in `src/frontend/controllers/controller.js` so that you can have `self.render(...)` instead of `self.renderJSON(...)`

Once it's done, you just need to refresh your browser.

Gina is shipped with [Swig](https://node-swig.github.io/swig-templates/) as the default template engine. If you are more confortable with another template engine, you can use your own.



### Setting your default environment
> By default, Gina comes with 2 environments : `dev` and `prod`. The default is `prod`. But if you are contributing to the framework or prototyping your application or service, we advise to use the `dev` environment.



__Setting starting env__
You can have multiple environments for your project and decide to pick one as the starting env by using `--env=your_env` everytime you have to run a bundle.

```tty
gina bundle:start frontend @myproject --env=prod
```


## Troubleshooting

### I can't start my bundle

__Are you starting for the first time ?__

- If you are a __Windows user__, make sure you are running your command line with sufficient permission; like __"launching your terminal as administrator"__.


- If you have just cloned Gina from github, don't forget to run from the project root :
```tty
node node_modules/gina/script/post_install.js
```

- Have you noticed the __environment argument__ ( prod ) ?

``` tty
gina bundle:start frontend --env=prod
```
Without the __prod__ argument, Gina is going to understand that you want to use the default environment (the one you have set by default for your project). If it's really what you want to achieve, just __build__ with your default prod which is `--env=dev`:
```tty
gina env:set @myproject --env=prod
```
> __NB.:__ you can set the defaut environment for your project like this:
> 

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