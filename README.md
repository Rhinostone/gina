# Gina.io

<a href="https://nodei.co/npm/gina/"><img src="https://nodei.co/npm/gina.png" alt="NPM" style="max-width:100%;"></a>

[Gina I/O](http://www.gina.io/) is the [Node.js](http://www.nodejs.org/) MVC framework you want to have for event driven applications or for APIs developpment. You can use gina for simple or very complex apps:

- webservices (for mobile apps, data communication)
- agent (monitoring, backup/sync, watchers)
- website (for a few html or markdown pages to publish)
- web apps (single page applications, video games)
- command line (system script maintenance, bash, framework plugins)

Gina is based on [expressjs](http://www.expressjs.com/) middleware; which means that migrating from your existing express applications to gina won't be a problem.


The project was under developement for two years before the publication of this page. We would like to thank [Thomson Reuters](http://www.thomsonreuters.com/) for their support and their contributions to the project.

Martin-Luther ETOUMAN   
Author of Gina I/O & CEO of Rhinostone.
   

## Motivation

The framework was built with passion and the will to share our experience of building web apps with everyone interested in web developpement.   
We wanted to make thing accessible and easier to beginers in web developement as well as for experts.
Gina is comes from previous experiments and bunch of previous projects: successfull & fails. It is a project still under active developpment, and we will try to communicate as much as possible on latest features and bug fixes.


## Installing gina

You can install gina __using npm__:

``` bash
$ npm install -g gina
```   
or via __Github__:   

```bash
$ git clone https://github.com/rhinostone/gina.git ./node_modules/gina
```   
followed by:   

```bash
$ node ./node_modules/gina/script/post_install.js
```


## Usage

``` bash   
$ gina -h
```
If you have a [posix](http://fr.wikipedia.org/wiki/POSIX) system, you can even use manpage to get more details:   
``` bash   
$ man gina
```


The framework works as a service, so make sure to have __administrator privilleges__ or appropriate permissions: this is even more true with __Windows__.   
> You can daemonize the service later so it can be launch at startup

``` bash
$ gina framewok:start 
```

## Feedback & contact informations
We hope this introduction page has been helpful for you. Please, feel free to contact us to let us know if and how we can improve it: <feedback@gina.io>

## Helping us
If you are enjoying gina and you are wondering how ou can help us making it a better toolbox, you can :
- donate when we start our kickstarter campain to raise monney for the project; just leave us your email at <kickstarter@gina.io> so we can contact you when we start rasing funds
- read, review, and translate documention & blog posts before publication
- become core contributor; developer, QA tester, designer
- become evangelist

## Sponsors
Here are the people thanks to whom gina is now a living creature.

Thomson Reuters, Jet Brain, Aikos & Rhinostone

