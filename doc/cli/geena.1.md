geena(1) -- CLI
=============================================

## NAME
**geena**

## SYNOPSIS
**geena**	[ **option** ]  
**geena**	[ **assetic**:**task**] [ **arguments** ]   
**geena**	[ **assetic**:**task**] [ **service** ] [ **arguments** ]

## DESCRIPTION
Geena is a MVC & Events Driven Framework that allows you to create.

## OPTIONS
**-v**, **--version**			Prints current framework version.

**-h**, **--help**			   Prints.

## ASSETICS
framework   
env   
project   
bundle   
model   

## ENVIRONMENT

**--version** | **GEENA_VERSION**   
		Will override the default framework **version** used by Geena.

**--env** | **GEENA_ENV**   
    	Will override the runtime environment.

**--node-version** | **GEENA_NODE_VERSION**   
    	Will override the **Node.js** version, the binary used by Geena.
        More than one version at the time can be used.

**--debug-brk** | **GEENA_DEBUG_BRK**

**--logs-path** | **GEENA_LOGS_PATH**

**--tmp-path** | **GEENA_TMP_PATH**

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

**geena-framework**(1), **geena-env**(1), **geena-project**(1), **geena-bundle**(1), **geena-model**(1)

## COLOPHON

This page is part of release {version} of the **geena** project. A description of the project,
and informations about reporting bugs can be found on the official web site: [http://www.geenajs.com](http://www.geenajs.com)

The project is also on GitHub: [https://github.com/rhinostone/geena](https://github.com/rhinostone/geena)

Here is the mailling list: [https://groups.google.com/forum/#!forum/geenajs](https://groups.google.com/forum/#!forum/geenajs)
