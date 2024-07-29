# Nx Github Pages

This project was generated using [Nx](https://nx.dev).

A simple Nx plugin to enable deploying a static project to Github Pages.

## Installation

To install the plugin, run:

```bash
nx add nx-github-pages
```

## Usage

Pick a project to deploy and run:

```bash
nx g nx-github-pages:configuration --project=<project-name>
```

After the configuration is generated, you can deploy the project by running:

```bash
nx run <project-name>:deploy
```
