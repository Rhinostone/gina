# Gina <img src="https://gina.io/favicon-16x16.png"  alt="Gina icon" style="position: absolute; top:10px; margin-right: 10px;" />

[![GitHub version](https://badge.fury.io/gh/Rhinostone%2Fgina.svg)](https://badge.fury.io/gh/Rhinostone%2Fgina) [![npm version](https://badge.fury.io/js/gina.svg)](https://badge.fury.io/js/gina) 

<strong>Gina I/O</strong> - Node.js MVC and Event Driven framework

> This is a `preview release`. We are looking for people to help us test and improve `Windows` support.
> Meanwhile, __Windows users__ can use Docker or an alternative to run Gina and their projects.
>
> Some commands or features might not work since the framework is still under development & testing
>
> We have some applications using the framework in production and we are improving our code in order to release the `1.0.0` version as soon as possible. Thank you for your patience.

## Philosophy behind

Gina was designed to be accessible, flexible, scalable and maintainable. Our main purpose was to allow developers to create easier and faster web applications.

Gina comes with essential features at this moment, but most of the things we don't have yet can be replaced by some alternatives written in other languages like: Ruby, PHP, .net, Python or C++. You are free to use such alternatives until we implement similar features.

Note that Gina does not rely on Connect or ExpressJS, still, you can use all plugins or middlewares designed for those frameworks ;-)

## Getting started with Gina I/O

### Installing Gina
Gina aims to be at the same time a framework, a deployment and monitoring environment for your projects. So, to fully enjoy Gina, we recommend that you install it with the `-g` option.
> For Microsoft Windows, you might have to run the command line with Administrator privileges.
> For Linux & Mac OS X:
> -  __the use of `sudo` is discouraged.__
> - you should have a dedicated user such as `node` with its group `node`

#### Versions

| versions | description |
|--------|--------|
| alpha       | Preview release: <mark>not recomanded for production</mark>      |
| latest       | Latest stable relase        |

#### 1st method (prefered) - Custom PREFIX

This will install Gina in the user's home directory avoiding at the same time the need to use `sudo` or the `root` user.
By adding at the end the `--reset` argument, you will ensure a factory reset for the `~/.gina` preferences folder: all `gina` preferences will be lost, but your existing projects will not be erased.

```tty
npm install -g gina@latest --prefix=~/.npm-global
```

You can now check if Gina is properly installed.

```  tty
gina version
```
__NB.:__ This is a shortcut for `gina framework:version`

#### 2nd method - Classical

```  tty
npm install -g gina@latest
```

Or with a `nobody:nogroup` user (not recomanded for production)

```  tty
npm install -g --unsafe-perm gina@latest
```

__A few words about this method__
This method is mainly used if you wish to install gina with the `root` user.
Gina will try to install itself using the default $NPM_PREFIX (`/usr/local`). If the target is not writable you will get permission errors.

__Note that for this method__, if the user is not `root`, you can setup permissions for your user in order to be able to write to : `$NPM_PREFIX/lib/node_modules`.

If you don't already have done it, you should start with :

```tty
sudo chown -R $USER $(npm config get prefix)/lib/node_modules
```


> __Important :__ If you choose to use `sudo npm install -g gina`, you will also have to use the `sudo` for specific commands like `npm link gina`.
> Again, the use of `sudo` is discouraged.



You can now check if Gina is properly installed.

```  tty
gina version
```
or
```  tty
sudo gina version
```
__NB.:__ This is a shortcut for `gina framework:version`



#### 3rd method - local to your project

If you feel like you do not need to install globally Gina for some reasons like only using the framework for a single project, you can install Gina without the `-g` argument.
Go to your project's root and tap:
```tty
npm install gina@latest
```

Or with a `nobody:nogroup` user (not recomanded for production)

```  tty
npm install --unsafe-perm gina@latest
```

__Attention:__  to use gina CLI, you will need to run it from your project location since the CLI was not installed with the global argument `-g`.

You can now check if Gina is properly installed.

```  tty
./gina version
```
__NB.:__ This is a shortcut for `./gina framework:version`




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

```tty
cd ~/Sites
```


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
__NB.:__ If you are launching the command from the project directory, you don't need to add `@myproject`. The same goes for all bundles commands.

We have just created a frontend application that will host our homepage.
You will find all bundle sources under `myproject/src`.

__Important:__ Since you are not running a local DNS Server, you have to change the host informations. Go to `myproject/env.json` & replace `dev` hostname from `frontend-{env}-{scope}-v{projectVersionMajor}.{rootDomain}` to `localhost`.
This is a tempory hack and gina will soon be provided with its own local DNS Server


You can start the bundle with the following command:

```tty
gina bundle:start frontend @myproject
```

> __Attention__
> Default memory is 4 GB (4096 MB)
> If you feel like you are going to need more [memory](https://blog.appsignal.com/2021/12/08/nodejs-memory-limits-what-you-should-know.html) for this particular bundle, let's say 8 GB:
> ```tty
> gina bundle:start frontend @myproject --max-old-space-size=8192
> ```


Now, visit http://localhost:3100/  to check your homepage.
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

Now edit the `home` control in `src/frontend/controllers/controller.content.js` so that you can have `self.render(...)` instead of `self.renderJSON(...)`


Once it's done, you just need to refresh your browser.

Gina is shipped with [Swig](https://node-swig.github.io/swig-templates/) as the default template engine. If you are more comfortable with another template engine, you can use your own.



### Setting your default environment

Please, note that you have 2 types of environments : one for the framework, and one for your project & your bundles.

> By default, Gina (the framework) comes with 2 environments : `dev` and `prod`. The default is `prod`. if you are [contributing](./README-4Contributors.md) to the framework or prototyping your application or service, we advise using the `dev` environment.
> ```tty
> gina framework:set --env=dev
> ```
> ```tty
> gina framework:set --log-level=debug
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

You can have multiple environments for your project and decide to pick one as the starting env by using `--env=<your_env>` every time you have to run a bundle.

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

__Attention:__ None-development `env` must be built before starting or restarting the bundle

```tty
gina project:build prod @myproject
```


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

__Benefits from using a `development` environment__
You will not have to restart your bundle anytime you modify files inside directories like :
- /controllers
- /public
- /templates

### Region
> __Attention :__ This will impact the logs output

The default timezone is set to `Africa/Douala`.
You can change it to your local timezone. For example, if you live in Johannesburg:

```tty
gina set --timezone=Africa/Johannesburg --date=yyyy/mm/dd
```


__Setup your bundle region preferences__
Edit `myproject/src/<bundle>/config/settings.json` to match your preferences.


### Logs

#### Getting the logs
You will get logs for the framework and related to your running bundles.

__1st Method - The default one__
``` tty
gina tail
```

__NB.:__ This is an alias for `gina framework:tail`
> __Attention__
> Everytime a bundle exits, the tail process will be closed. To prevent tail from exiting, you can use the `--keep-alive` argument.
> E.g.: `gina tail --keep-alive`

By default, Gina does not store logs. Logs are treated like any other events then printed out to the `process.stdout`.

This means that if you need Gina to handle logs storage, you need a logger container (or transport) to receive and output your logs.

Note that this is optional since logs are output like for other frameworks: you can catch those while writing your daemon starting script on you production server.

So to handle log storage for your application, you have 2 options: see 2nd & 3rd Methods.

__2nd Method - Old school way__

> With this method, you will have to handle yourself [log rotation](https://linux.die.net/man/8/logrotate)

```tty
gina bundle:start frontend @myproject --log > /usr/local/var/log/gina/frontend.myproject.app.log 2>&1
```
You can now check
```tty
tail - f /usr/local/var/log/gina/frontend.myproject.app.log
```

__3rd Method - Create your own container/transport by extending gina default container__


If you still want gina to handle logs storage, you are lucky, we have developped a file container/transport that you just need to enable.

> This feature is still experimental.

You can edit `~/.gina/user/extensions/logger/default/config.json` to add `"file"` container to the `flows`.

You might need to restart the gina :

```tty
gina restart
```

__NB.: __  For development purposes, using the CLI `gina tail` is still a better option because you will have a better overview of what is really going on for all your application at once & for the framework.

#### Setting default log level

By default Gina is set to `info`. Here is the list of available log level hierarchies.

| levels | Included messages |
|--------|--------|
| trace  | Emergency, Alert, Critical, Error, Warning, Notice, Informational, Debug        |
| debug  | Emergency, Alert, Critical, Error, Warning, Notice, Informational, Debug       |
| info   | Emergency, Alert, Critical, Error, Warning, Notice, Informational       |
| warn   | Emergency, Alert, Critical, Error, Warning, Notice       |
| error  | Emergency, Alert, Critical, Error, Notice     |
| fatal  | Emergency, Alert, Critical, Notice       |

If you are at the developpemnt stage of your project, you might want to get all debug messages.
```tty
gina framework:set --log-level=debug
```

## HTTPS, HTTP/2 and certificates

### Installing a certificate

> __Attention__
> ==One certificate per bundle/service==

You now want to install a certificate for your project in order to run your project with HTTPS scheme or with HTTP/2 protocol ?
At this moment, Gina does not generate a cetificate for you, but you can use a service like [sslforfree](https://www.sslforfree.com) to genreate a free 90 days certificate, then install it into your Gina home directory depending on the scope of your host (targeted machine: local or production).
[SSL For Free](https://www.sslforfree.com) will provide you with a folder named with the domain you have used to setup your certificate. You just need to paste its content into the right location.

The directory should be located @`~/.gina/certificates/scopes`.
By default, `local` scope is set. But when you will go live, you should set the scope to production and paste your certificate into the right folder.
__E.g:__ The `frontend.myproject.app` folder should be placed into:
- `~/.gina/certificates/scopes/local` for your dev host
- `~/.gina/certificates/scopes/production` for you production host


### Enable HTTPS scheme
> __NB.:__ `certificate` is `required`.
> By enabling HTTPS, you will do so for your entire poroject by default, but you can later set one per application.
> And if you want to run our experimental HTTP2 implementation, you will need HTTPS scheme.

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

Do not panic, and follow the steps to solve this issue are provided in the following section.

### Local scope & certificate consideration
> __Ignore__ the following instructions __if you can start your application__ without any certificate errors.

This is __important__ and you will have to take additional steps to make your certificate fully valid __while developping on your `local/dev host`__.
Since in most cases you will not have the `Root Certificate` included in your certificate, you need to generate a correct certificate including the Root Certificate. __For production, it will not be a problem__ since the Root certificate is provided by the client browser.

__Attention:__ We are assuming that for the following example, you have a wildcard certificate. If this is not possible, you will have to generate a certificate for each bundle and treat each bundle like a subdomain.

Let say that you have downloaded your certificates from __[Ssl For Free](https://sslforfree.com)__ which you have then placed under: `~/.gina/certificates/scopes/local/frontend.myproject.app`.

__Step 1__
Go to the folder
```tty
cd ~/.gina/certificates/scopes/local/frontend.myproject.app
```

List your files
```tty
ls
```

Output should look like
```tty
ca_bundle.crt	certificate.crt	private.key
```

Now, copy the content of `certificate.crt`
```tty
cat certificate.crt
```


Visit [https://whatsmychaincert.com](https://whatsmychaincert.com)
Go to the `Generate the Correct Chain` tool.
Paste the content you have just copied out of your `certificate.crt` into the field, then __do not forget to check the option__ `Include Root Certificate`.

__It will download a chained certificate__.
Rename it to `certificate.chained+root.crt` and copy/paste the file to your certificates location (~/.gina/certificates/scopes/local/frontend.myproject.app)

__Step 2__
You now need to combine your private key with your new certificate
Still @ `~/.gina/certificates/scopes/local/frontend.myproject.app` ?

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
    // "certificate": "{GINA_HOMEDIR}/certificates/scopes/{scope}/{host}/certificate.crt",
    "ca": "{GINA_HOMEDIR}/certificates/scopes/{scope}/{host}/certificate.combined.pem"
}
```

Do this for all of you `myproject`'s bundles, then restart your bundles
```tty
gina bundle:restart @myproject
```

__Remember__
You will need a certificate for each bundle/service, unless you get a `wildcard certificates`.
If you have a  `wildcard certificates`, you only need to follow the folling steps once, then create a symling for each bundle/service to the main certificate.

```tty
ln -s ~/.gina/certificates/scopes/local/myproject.app ~/.gina/certificates/scopes/local/frontend.myproject.app
```

### Uninstalling Gina

> For Microsoft Windows, you might have to run the command line with Administrator privileges.

__Wihtout prefix__
```  tty
npm uninstall -g gina
```

Or if you have an Error like `EACCESS: permission denied, mkdir '/usr/local/lib/node_modules/gina'`

__With prefix - If Gina was installed with a prefix__
```tty
npm uninstall -g gina --prefix=~/.npm-global
```




## Troubleshooting

### My settings are broken, I need a fresh install with the default settings
```tty
npm install -g gina@latest --reset
```


### I can't start my bundle

__Are you starting for the first time ?__

- If you are a __Windows user__, make sure you are running your command line with sufficient permission; like __"launching your terminal as administrator"__.


- If you have just cloned Gina from GitHub, don't forget to run from the framework root :

```tty
node node_modules/gina/script/pre_install.js -g
```

```tty
node node_modules/gina/script/post_install.js -g
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

Copyright © 2009-2023 [Rhinostone](http://www.rhinostone.com/)

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
