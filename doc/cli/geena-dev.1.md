geena-dev(1) -- Command line interface
=============================================

## NAME

**geena dev**

## SYNOPSIS

**geena dev** [ **option** ]

or

**geena f**:[ **task** ] [ **arguments** ]


## DESCRIPTION
**geena framework** alows you to perform tasks on the framework and its services.

## OPTIONS

**-h**, **--help** Prints help for **geena dev** command.

## TASKS

**man**
	
    Generate manpage.


## ARGUMENTS



## EXEMPLE

**geena dev**'s command line only works if the framework is running.

e.g. Generate and link manpages using groff and html style.

~~~ tty
$ geena dev:man --groff --html=/custom/path
~~~




## AUTHOR

Martin-Luther ETOUMAN was the original author of **geena-dev**. Stephane HEAV joined the project since version 0.1.0.

## COPYRIGHT
Copyright (c) 2009-{year} Rhinostone <geena@rhinostone.com>

## SEE ALSO

**geena**(1), **geena-project**(1), **geena-bundle**(1), **geena-model**(1)

## COLOPHON

This page is part of release {version} of the **geena** project. A description of the project,
and informations about reporting bugs can be found on the official web site: [http://www.geenajs.com](http://www.geenajs.com)

The project is also on GitHub: [https://github.com/rhinostone/geena](https://github.com/rhinostone/geena)

Here is the mailling list: [https://groups.google.com/forum/#!forum/geenajs](https://groups.google.com/forum/#!forum/geenajs)
