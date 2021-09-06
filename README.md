# xOpera SaaS plugin for VS Code/Eclipse Che Theia
This repository allows you to set up VS Code/Eclipse Che Theia [xOpera SaaS plugin]. If you are totally unfamiliar with 
xOpera you can take a look at the [xOpera's documentation].

| Aspect                         | Information                               |
| ------------------------------ |:-----------------------------------------:|
| Documentation                  | [xOpera SaaS plugin documentation]        |
| Open VSX Registry              | [Open VSX Registry plugin link]           |
| Visual Studio Marketplace      | [VS Marketplace plugin link]              |
| Video                          | [xOpera SaaS with Eclipse Che]            | 

## Table of Contents
  - [Installation and publishing](#installation-and-publishing)
    - [Visual Studio Code installation](#vs-code-installation)
    - [Eclipse Che installation](#eclipse-che-theia-installation)
    - [Publishing the plugin](#publishing)
  - [Main features](#main-features)

## Installation and publishing
This is originally a [Visual Studio Code] extension/plugin, so the best way to test it locally is to through VS Code's 
extension development host. [RADON IDE] is represented by [Eclipse Che] which uses an open-source cloud and desktop IDE 
framework called [Eclipse Theia] within the workspaces. [Eclipse Theia] is very similar to VS Code and therefore VS 
Code extensions can be also used in Theia.

### VS Code installation
The plugin can be installed through [Visual Studio Marketplace] here: [VS Marketplace plugin link].

To install the plugin without the VS Marketplace to your VS Code editor you will need the latest `vsix` plugin package, 
which you can download get here: [VS Marketplace plugin link] (or check [Releases]). Then you just have to import the 
`vsix` file to the VS Code plugins and after that you will be able to use the plugin in any VS Code window.

### Eclipse Che Theia installation
TPS plugin was primarily meant for usage in [Eclipse Theia] which is the main editor in the [Eclipse Che]/[RADON IDE]. 
THe plugin is available in the [Open VSX Registry] here: [Open VSX Registry plugin link].

To install the plugin manually to [Eclipse Che] you will need the prepared YAML devfile (which also uses the prepared 
`meta.yaml` file). The files to try this can be found in [publishing-samples](./publishing-examples).

### Publishing
Here's what you need to do to test the plugin and to package/publish it:

```console
# install Node JS from https://nodejs.org/en/download/
# and test it with node -v and npm -v command

# install prerequisite packages
npm install

# test the plugin in VS Code (this will open a new window with your extension loaded)
press F5 (Run Extension)

# package and publish the extension
# if you don't have npx install it with: npm install npx
npx vsce package
```

## Main features
The extension uses [xOpera SaaS REST API] and can therefore invoke various xOpera SaaS actions. 

The plugin currently allows users to:

- create a new SaaS workspace
- create a new SaaS project in a new or existing workspace
- deploy a project

[xOpera SaaS plugin]: https://xlab-si.github.io/xopera-docs/saas.html#eclipse-che-vs-code-plugin-for-xopera-saas
[xOpera documentation]: https://xlab-si.github.io/xopera-docs/
[xOpera SaaS plugin documentation]: https://xlab-si.github.io/xopera-docs/saas.html#eclipse-che-vs-code-plugin-for-xopera-saas
[Open VSX Registry plugin link]: https://open-vsx.org/extension/xlab/xopera-saas
[VS Marketplace plugin link]: https://marketplace.visualstudio.com/items?itemName=xlab.xopera-saas
[xOpera SaaS with Eclipse Che]: https://www.youtube.com/watch?v=SIiLOe5dSqc 
[RADON IDE]: https://github.com/radon-h2020/radon-ide
[Eclipse Che]: https://www.eclipse.org/che
[Eclipse Theia]: https://theia-ide.org
[Visual Studio Code]: https://code.visualstudio.com
[Visual Studio Marketplace]: https://marketplace.visualstudio.com/
[Releases]: https://github.com/xlab-si/radon-xopera-saas-plugin/releases
[Open VSX Registry]: https://open-vsx.org/
[xOpera SaaS REST API]: https://xlab-si.github.io/xopera-docs/saas.html#saas-api
