# The contributor guide

### Setting the framework default environment (Gina contributors only)
> By default, Gina comes with 2 environments : `dev` and `prod`. The default is `prod`. But if you are contributing to the frameworkn we advise you you to use the `dev` environment.

__Changing default env__
By default, Gina is installed with `dev` environment which allow you to display the toolbar.
If you need to change this:
```tty
gina framework:set --env=dev
```

This only means that when you omit the env in the command line, it will automatically add `--env=prod` for you when startig the framework.

> __NB:__ the framework env list cannot be changed.
