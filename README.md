# Gina

<strong>Gina I/O</strong> - Node.js MVC and Event Driven framework



Node.js(90%), other(10% - optional)

## Philosophy behind

Gina was designed to be accessible, flexible, scalable and maintainable. Our main purpose was to allow developpers to create easier and faster web applications.

Gina comes with essential features at this moment, but most of the things we don't have yet can be replaced by some alternatives written in other languages like: Ruby, PHP, .net, Python or C++. You are free to use such alternatives until we implement similar features.

## Getting started with Gina I/O

### Initializing a project
Let's create our first project and install gina.

``` tty
$ mkdir myproject
```

``` tty
$ cd myproject
```

You can now install the framework using npm:

```  tty
$ npm install gina
```
Then you need to __initialize your project__

> On Mac Os X or on Linux   

```  tty
$ ./gina -i myproject
```

> on Windows from the Windows CLI - __NEED TO BE ADMIN !!__ 

```  tty
$ gina -i myproject
```


__NB:__ All gina commands are launched from the project root.

### Creating a bundle (application)

A project is a set of bundles. Gina lets you create all kind of bundles :
* api & webservices
* frontend & backend applications
* command lines

Note that the default bundle type is api.

Ok ! Let's do it !

``` tty
$ gina -a frontend
```

We have just created a frontend application that will host our homepage.
You will find all bundle sources under `myproject/src`.

You can start the bundle with the following command:

```tty
$ gina -s frontend dev
```
Now, visite http://127.0.0.1:3100/  to check your homepage.   
Isn't it sexy !?

If you need to stop it, just hit `ctrl+c`.


### Adding views

The default bundle renders a json representation of a "Hello World" message.   

Let's add views on our frontend

```tty
$ gina -av frontend
```
Now edit the `init` action in `src/frontend/controllers/controller.js` so that you can have `self.render(...)` instead of `self.renderJSON(...)`  

Once it's done, you just need to refresh your browser.

Gina is shipped with [Swig](http://paularmstrong.github.io/swig/docs/) as the default template engine. If you are more confortable with another template engine, you can use your own.


More documentation and tutorials are coming !


## License (MIT)

Copyright (c) 2009-2014 [Rhinostone](http://www.rhinostone.com/)

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