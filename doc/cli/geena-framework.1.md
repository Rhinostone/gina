geena-framework(1) -- Framework CLI
=============================================

## SYNOPSIS

**geena framework** [ **option** ]

**geena framework**:[ **task** ] [ **service** | **arguments** ]

**geena framework**:[ **task** ] [ **service**] [ **arguments** ]


## DESCRIPTION
**geena framework** alows you to perform tasks on the framework and its services.

## OPTIONS

**-t**, **--status**
		Get status of the framework.

**-h**, **--help**
		Prints help for **geena framework** command.

## TASKS

**-s**, **start**
		Starts the framework.

**-k**, **stop** | **kill**
		Stops the framework.

**-r**, **restart**
    	Restarts the framework.

**-u**, **update**
    	Get status of the framework.

**-e**, **set**
		Set environment variables


## ENVIRONMENT ARGUMENTS

**--version=val**
    	Tells Geena to run services with a specific framework version.

e.g. Start Geena using v0.1.5 of the framework

~~~ tty
$ geena framework:start --version=0.1.5
~~~

> N.B.: This will override default settings. See `geena-framework` manpage.

**--env=val**
    	Tells Geena to run services with a specific framework environment.

e.g. Runs the framework with development environment
~~~tty
$ geena framework:start --env=dev

~~~

**--node-version=val**
    	It is the **Node.js** version, the binary used by Geena.
        More than one version at the time can be used.

## EXEMPLE

**geena**'s command line only works if the framework is started.
You can start the framwork this way

~~~ tty
$ geena framework:start
~~~
or by using the alias
~~~ tty
$ geena start
~~~


## AUTHOR

Martin-Luther ETOUMAN was the original Author of **geena**. Stephane HEAV joined the project since version 0.1.0.

## COPYRIGHT
Copyright (c) 2009-{year} Rhinostone <geena@rhinostone.com>

## SEE ALSO

**geena**(1), **geena-project**(1), **geena-bundle**(1), **geena-model**(1)

## COLOPHON

This page is part of release {version} of the **geena** project. A description of the project,
and informations about reporting bugs can be found on the official web site: [http://www.geenajs.com](http://www.geenajs.com)

The project is also on GitHub: [https://github.com/rhinostone/geena](https://github.com/rhinostone/geena)

Here is the mailling list: [https://groups.google.com/forum/#!forum/geenajs](https://groups.google.com/forum/#!forum/geenajs)
