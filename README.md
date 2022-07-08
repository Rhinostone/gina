# Gina
[![GitHub version](https://badge.fury.io/gh/Rhinostone%2Fgina.svg)](https://badge.fury.io/gh/Rhinostone%2Fgina) [![npm version](https://badge.fury.io/js/gina.svg)](https://badge.fury.io/js/gina)

<strong>Gina I/O</strong> - Node.js MVC and Event Driven framework

> This is a `preview release`. We are looking for people to help us test and improve `Windows` support.
> Meanwhile, __Windows users__ can use Docker or an alternative to run Gina and their projects.
> 
> Some commands or features might not work since the framework is still under development & testing
> 
> We have some applications using the framework in production and we are improving our code in order to release the `1.0.0` version: which should come by the end of 2022. Thank you for your patience.

## Philosophy behind

Gina was designed to be accessible, flexible, scalable and maintainable. Our main purpose was to allow developers to create easier and faster web applications.

Gina comes with essential features at this moment, but most of the things we don't have yet can be replaced by some alternatives written in other languages like: Ruby, PHP, .net, Python or C++. You are free to use such alternatives until we implement similar features.

Note that Gina does not rely on Connect or ExpressJS, still, you can use all plugins or middlewares designed for those frameworks ;-)

## Getting started with Gina I/O

### Installing Gina
Gina aims to be at the same time a framework, a deployment and monitoring environment for your projects. So, to fully enjoy Gina, we recommend that you install it with the `-g` option.
> For Microsoft Windows, you might have to run the command line with Administrator privileges.

```  tty
npm install -g gina@latest
```

You can check if Gina is properly installed
```  tty
gina version
```
__NB.:__ This is a shortcut for `gina framework:version`


### Starting the framework
Gina is at the same time a framework and a server.
By starting the framework, you will also start the server.

``` tty
gina start
```
__NB.:__ This is an alias for `gina framework:start`


### Initializing a project
A project is a collection of bundles (applicaitons or services). See it as a representation of your domain.

Let's create our first project and install Gina.

``` tty
mkdir myproject && cd myproject
```


Then you need to __initialize your project__

> On Windows from the Windows CLI, you might need admin privileges.

```  tty
gina project:add @myproject
```

If you need to remove this project later
```  tty
gina project:rm @myproject
```

### Creating a bundle (application or service)

A project is a set of bundles. Gina lets you create all kinds of bundles :
* API & web services
* frontend & backend applications
* command lines

Note that the default bundle type is API.

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


Now, visit http://127.0.0.1:3100/  to check your homepage.
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

The default bundle renders a JSON representation of a "Hello World" message.

Let's add a view on our frontend

```tty
gina view:add frontend @myproject
```
Then restart your bundle
```tty
gina bundle:restart frontend @myproject
```

Now edit the `home` control in `src/frontend/controllers/controller.js` so that you can have `self.render(...)` instead of `self.renderJSON(...)`

Once it's done, you just need to refresh your browser.

Gina is shipped with [Swig](https://node-swig.github.io/swig-templates/) as the default template engine. If you are more comfortable with another template engine, you can use your own.



### Setting your default environment

Please, note that you have 2 types of environments : one for the framework, and one for your project & your bundles.

> By default, Gina (the framework) comes with 2 environments : `dev` and `prod`. The default is `prod`. if you are [contributing](./README-4Contributors.md) to the framework or prototyping your application or service, we advise using the `dev` environment.
> ```tty
> gina framework:set --env=dev 
> ```

You can check which are the environments set for your projects
```tty
gina env:list
```
__or for a particular project__
```tty
gina env:list @myproject
```

__NB.:__ when adding an environement, you will do so for the entire project.

#### Setting your application starting environment on runtime
> This method does not memorize the selected environment as the default one for your application

You can have multiple environments for your project and decide to pick one as the starting env by using `--env=your_env` every time you have to run a bundle.

```tty
gina bundle:start frontend @myproject --env=prod
```
__NB.:__ Omitting `--env=<env>` will fallback to your project default environment.

#### Setting your project or your application default environment

For the entire project & for all bundles inside by default
```tty
gina env:use prod @myproject
```
__NB.:__ If you need to change it for a particular bundle, you still can do it at runtime using `--env=<your env>` to override the default settings. This will not set `<your env>`as the default environment for the whole project.


#### Other operations you can apply to your environment:
__Adding a new environment for your project__
```tty
gina env:add staging @myproject
```
__Removing an existing environment for your project__
```tty
gina env:rm staging @myproject
```

__Defining an existing environment as `development` (you can only have one like this)__
```tty
gina env:link-dev <your new dev env>
```

### Getting the logs
You will also get logs related to your running bundles.
``` tty
gina tail
```
__NB.:__ This is an alias for `gina framework:tail`

By default, Gina does not store logs. Logs are treated like any other events then printed out to the `process.stdout`.

This means that if you need Gina to handle logs storage, you need a logger container (or transport) to receive and output your logs.

Note that this is optional since logs are output like for other frameworks: you can catch those while writing your daemon starting script on you production server.

So to handle log storage for your application, you have 2 options.
__1) Old school way__
```tty
gina bundle:start frontend @myproject > /usr/local/var/log/gina/frontend.myproject.domain.log 2>&1
```
You can now check
```tty
tail - f /usr/local/var/log/gina/frontend.myproject.domain.log
```

__2) Create your own container/transport by extending gina default container__


If you still want gina to handle logs storage, you are lucky, we have developped a file container/transport that you just need to enable.

> This feature is still experimental.

You can edit `~/.gina/user/extensions/logger/default/config.json` to add `"file"` container to the `flows`.

You might need to restart the gina :

```tty
gina restart
```

__NB.: __For development purposes, using the CLI `gina tail` is still a better option because you will have a better overview of what is really going on for all your application at once & for the framework.

## HTTPS, HTTP/2 and certificates

### Installing a certificate
You now want to install a certificate for your project in order to run your project with HTTPS scheme or with HTTP/2 protocol ?
At this moment, Gina does not generate a cetificate for you, but you can use a service like [sslforfree](https://www.sslforfree.com) to genreate a free 90 days certificate, then install it into your Gina home directory depending on the scope of your host (targeted machine: local or production). 
[SSL For Free](https://www.sslforfree.com) will provide you with a folder named with the domain you have used to setup your certificate. You just need to paste its content into the right location.

The directory should be located @`~/.gina/certificates/scopes`.
By default, `local` scope is set. But when you will go live, you should set the scope to production and paste your certificate into the right folder.
__E.g:__ The `myproject.domain` folder should be placed into:
- `~/.gina/certificates/scopes/local` for your dev host
- `~/.gina/certificates/scopes/production` for you production host


### Enable HTTPS scheme
> __NB.:__ `certificate` is `required`.
> By enabling HTTPS, you will do so for your entire poroject by default, but you can later set one per application.
> And if you want to run your experimental HTTP2 implementation, you will need HTTS scheme.

Check what is your actual scheme & protocol status
```tty
gina protocol:list @myproject
```

Setup HTTPS for the whole project
```tty
gina protocol:set @myproject
```

Setup HTTPS for a specific application
```tty
gina protocol:set frontend @myproject
```

Now, you just need to restart your bundle. You should tail your logs in order to get more details if an error is preventing you from starting.

```tty
gina tail
```

Open another terminal window
```tty
gina bundle:restart frontend @myproject
```


Depending on how you have managed to get your certificate for you dev environment, you might get this kind of mesaage preventing your application to start :

```tty
Error: unable to get issuer certificate
    at TLSSocket.onConnectSecure (node:_tls_wrap:1530:34)
    at TLSSocket.emit (node:events:390:28)
    at TLSSocket._finishInit (node:_tls_wrap:944:8)
    at TLSWrap.ssl.onhandshakedone (node:_tls_wrap:725:12) 
```

Do not panic, and follow the steps provided in the following section.

### Local scope & certificate consideration
Ignore the following instructions if you can start your application without any certificate errors.

This is `important` and you will have to take additional steps to make your certificate fully valid __while developping on your `local/dev host`__.
Since in most cases you will not have the `Root Certificate` included in your certificate, you need to generate a correct certificate including the Root Certificate. __For production, it will not be a problem__ since the Root certificate is provided by the client browser.

Let say that you have downloded your certificates from __[Ssl For Free](https://sslforfree.com)__ which you have then placed under: `~/.gina/certificates/scopes/local/myproject.domain`.

__Step 1__
Go to the folder
```tty
cd ~/.gina/certificates/scopes/local/myproject.domain
```

List your files
```tty
ls
```

Output should look like
```tty
ca_bundle.crt	certificate.crt	private.key
```


```tty
cat certificate.crt
```
Copy the content of `certificate.crt`

Visit [https://whatsmychaincert.com](https://whatsmychaincert.com)
Go to the `Generate the Correct Chain` tool.
Paste the content you have just copied out of your `certificate.crt` into the field, then __do not forget to check the option__ `Include Root Certificate`.

__It will download a chained certificate__.
Rename it to `certificate.chained+root.crt` and copy/paste the file to your certificates location (~/.gina/certificates/scopes/local/myproject.domain)

__Step 2__
You now need to combine your private key with your new certificate
Still @ `~/.gina/certificates/scopes/local/myproject.domain` ?

```tty
cat private.key certificate.chained+root.crt > certificate.combined.pem
```

__Final step__

Go to your project src to add or edit your bundle config the following file : `/path/to/myproject/src/frontend/config/settings.server.credentials.dev.json`
Where `frontend` is you bundle/application

We just need to override Gina default certificate paths
```tty
{
    // "privateKey": "{GINA_HOMEDIR}/certificates/scopes/{scope}/{host}/private.key",
    "certificate": "{GINA_HOMEDIR}/certificates/scopes/{scope}/{host}/certificate.chained+root.crt",
    "ca": "{GINA_HOMEDIR}/certificates/scopes/{scope}/{host}/certificate.combined.pem"
}
```

Do this for all of you `myproject`'s bundles, then restart your bundles
```tty
gina bundle:restart @myproject
```



## Troubleshooting

### I can't start my bundle

__Are you starting for the first time ?__

- If you are a __Windows user__, make sure you are running your command line with sufficient permission; like __"launching your terminal as administrator"__.


- If you have just cloned Gina from GitHub, don't forget to run from the project root :

```tty
node node_modules/gina/script/pre_install.js
```

```tty
node node_modules/gina/script/post_install.js
```


__Are you trying to restart after a crash ?__

Before v0.1.0, Gina used 2 processes for each bundle: one master, one slave.
Once an exception is thrown and the program crashes, one of the 2 processes can remain in the `tasks/processes` list.

Gina only uses one process per bundle or one per project if you have decided to merge bundles execution.
This has been mostly observed for Windows users.

- If you are on a POSIX OS, you should look for `gina`, then kill it !

- If you are on a Windows, look for `node.exe` or  `Event I/O Handler`, then kill it !

After this, try again to start, it should run better.




More documentation and tutorials are coming soon !


## License (MIT)

Copyright © 2009-2022 [Rhinostone](http://www.rhinostone.com/)

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
