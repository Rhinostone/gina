Installing, updating or downgrading Geena
------------------------------------
------------------------------------


Thank you for your interest

Requirements
-----------

You need:

* [Node.js](http://nodejs.org/) v0.10.25+, [npm](https://npmjs.org/)
* Linux, Mac Os X or Windows
* 32-bit or 64-bit processor
* [Git](http://git-scm.com/) (latest if possible) or not...


From here, you have 2 different ways of installing Geena:

- thru **npm** (Node Package manager) - the easy way !
- or thru GitHub

Now you are ready to go ! Yeah... just ignore the next lines.


With NPM
----------------------

### Installing

Your are using svn or no scm at all, no problemo !

Open your terminal, and install the command line tool:

If you are looking for the last stable version, just hit:

```
$ npm install -g geena
```

Now you shoud be good to go. If not, check troubleshooting section down
this page.

### Launching geena

```
$ geena framework:start
```

> Geena runs like a service !


## Updating Geena

Once you have installed Geena, you can get latest version of the
framework when they are available.

Let's say your current version is `0.1.0` and you want to get the `0.1.2`.


```
$ geena framework:update 0.1.2
```

## Downgrading

version: x.x.x

The first digit represents a
Works like You will need to reinstall using the version number you are targeting.

The first digit represents a software release: 1.x.x and 2.x.x will be 2 differents softwares.

Downgrade are only supported from the same release version.
you can downgrade from `0.1.2` to `0.1.1` or from `0.2.10` to `0.1.0` without any troubles, but `1.5.0` and `0.5.1` will be too different for you to switch: you will have to reinstall.



Now you are ready to go !

Troubleshooting
--------------

Well, it's not perfect yet. If for a reason or another you can't
complete the installation using Geena Installer, try to find out if the
following answer can help solving the problems you might encounter while
trying to install.

### I can't install with npm

 **Are** you behind a proxy ?

It might be some proxy problems. Check on this
[link](https://github.com/isaacs/npm/issues/1850)


### I can't install or update thru GitHub

Use ```https``` instead of ```ssh```for your remote origins and you
should be fine.

NB.: Now if you are installing with git and you decide to use
```https```mode, it would be nice to tell the Geena Installer.

If you don't have a package.json yet, It might be time to create one. If
you do have one, just edit it by adding the ```submodules``` section
with the key ```use_https```.

```
"submodules": {
      "use_https" : true
 }
```

**Were** you behind a proxy ?

```
fatal: unable to access 'https://github.com/Rhinostone/geena.git/':
Failed connect to github.com:80; Operation timed out
```
If you getting this message, I guess it's a yes.

Now that you are not any more behind one, There is 2 choices

Maybe you need to set a proxy in your global
Edit your github globals (proxy): http://stackoverflow.com/questions/5529218/how-to-use-git-behind-a-proxy 

Or, maybe you already have setttings from a previous configuration.. it's happens when you switch from work => home.

1. Remove the proxy form your network connection
2. Change your git remote origin








