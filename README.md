# Roku Atom
The package for Atom IO Text Editor

## Features
   - Full BrightScript syntax highlight support.
   - Autocompletion of SceneGraph components XML layout.
   - Roku autocompletion of SDK components, fields, global functions, etc.
   - If/For/While/etc. autoclosing feature.
   - Code analysis for debug breakpoints on deploy.
   - Deploy to Roku box from editor.

## Installation

### Core Plugin:
1. Install Atom: https://atom.io/
2. Go to `~/atom/packages/` or `C:\Users\user.name\.atom\packages`
3. Create folder `atom_roku`
4. Copy all files to atom_roku folder
5. Open terminal
6. Enter the `atom_roku` folder and run `apm install`
- If `apm` is not found:
   - Windows: Add `C:\Users\user.name\AppData\Local\atom\bin` to PATH
   - Linux and MacOS: Make a symbolic link from `atom/bin/apm` directory to `/usr/local/bin`
7. Go to File/Settings and select Packages and find `atom_roku` in list to change IP.

### Additional Packages:
Autocomplete+ provider for XML via XSD: [download autocomplete-xml](https://atom.io/packages/autocomplete-xml)

The XSD file follows the W3C standard. The XML file to autocomplete ask for validation.
That is, the root element must looks like:

    <component name="SomeComponentName..." xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" extends="Scene" xsi:noNamespaceSchemaLocation="http://rokudev.roku.com/rokudev/schema/RokuSceneGraph.xsd">

## Preview

**General overview:** Syntax highlighting, Deploy, etc.

![Deploy](documentation/deploy.gif "Deploy")

**Code sample:** for-each autocomplete

![For Each](documentation/for_each.gif "For Each")

**Code sample:** while loop autocomplete

![While](documentation/while.gif "While")

**Code sample:** global functions autocomplete

![Global Functions](documentation/global_functions.gif "Global Functions")
