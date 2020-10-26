import * as fs from 'fs';
import { IncomingMessage, request } from 'http';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as req from 'request';
import * as yaml from 'js-yaml';
import { JSDOM } from 'jsdom';
import { CookieJar, Cookie } from 'tough-cookie';
import { SaasApi } from './api';
import { Workspace } from './openapi/model/workspace';
import { HttpError } from './openapi/api';

// to anyone reading this code
// sorry

const doCookieRequest = async (method: string, url: string, formData: object | undefined, cookieJar: CookieJar) => new Promise<IncomingMessage>((resolve, reject) => {
    req(url, {
        method: method,
        form: formData,
        headers: {
            "cookie": jarToHeader(url, cookieJar)
        },
        followRedirect: false,
        followAllRedirects: false,
    }, (error, response, body) => {
        if (error) {
            reject(error);
        } else {
            if (response.statusCode && response.statusCode >= 200 && response.statusCode <= 399) {
                console.log("response for url", url, response)
                updateJar(url, cookieJar, response)
                resolve(response);
            } else {
                console.error(response)
                reject(new HttpError(response, response.statusCode));
            }
        }
    });
});

const updateJar = (url: string, jar: CookieJar, response: IncomingMessage) => {
    const setCookieHeaders = response.headers['set-cookie']!!
    console.log("updating cookies from set-cookie", setCookieHeaders)
    const newCookies = setCookieHeaders.map(c => Cookie.parse(c)!!)
    newCookies.forEach(c => {
        jar.setCookie(c, url)
    })
    console.log("updated jar", jar)
}

const jarToHeader = (url: string, jar: CookieJar) => {
    const cookies = jar.getCookiesSync(url).map(c => {
        return c.cookieString()
    })
    console.log("rendering cookies", cookies)
    return cookies
}

const doLoginProcedure = async (cookieJar: CookieJar) => {
    let needsLogin = false

    const credsForAuthResponse = await doCookieRequest(
        "GET",
        SaasApi.basePath + "/credential",
        undefined,
        cookieJar
    )

    if (300 <= credsForAuthResponse.statusCode!! && credsForAuthResponse.statusCode!! <= 399) {
        console.log("we've been redirected")
        needsLogin = true
    }

    if (!needsLogin) {
        return
    }

    const inputUsername = await vscode.window.showInputBox({
        prompt: "Username",
        ignoreFocusOut: true
    })
    const inputPassword = await vscode.window.showInputBox({
        prompt: "Password",
        ignoreFocusOut: true,
        password: true
    })

    if (inputUsername === undefined || inputPassword === undefined) {
        vscode.window.showErrorMessage("Deployment canceled, no creds upon request.")
        return
    }

    console.log("fetching redirected auth page")
    const redirectedAuthPageResponse = await doCookieRequest(
        "GET",
        credsForAuthResponse.headers["location"]!!,
        undefined,
        cookieJar
    )

    //@ts-ignore
    const doc = new JSDOM(redirectedAuthPageResponse.body).window.document
    //@ts-ignore
    const actionUrl = doc.querySelector("#kc-form-login").attributes["action"].value
    console.log("action url", actionUrl)

    const loginFormSubmitResponse = await doCookieRequest(
        "POST",
        actionUrl,
        { "username": inputUsername, "password": inputPassword, "credentialId": "" },
        cookieJar
    )

    console.log("making request to oauth callback")
    const responseToOauthCallbackRedirect = await doCookieRequest(
        "GET",
        loginFormSubmitResponse.headers["location"]!!,
        undefined,
        cookieJar
    )
    console.log("response to oauth callback redirect response", responseToOauthCallbackRedirect)

    if (300 <= responseToOauthCallbackRedirect.statusCode!! && responseToOauthCallbackRedirect.statusCode!! <= 399) {
        console.log("redirection of the _oauth request occurred, following")
        const secondRTOCR = await doCookieRequest(
            "GET",
            responseToOauthCallbackRedirect.headers["location"]!!,
            undefined,
            cookieJar
        )
    } else {
        console.log("no redirection occurred")
    }
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Congratulations, your extension "xopera-vscode-extension" is now active!');

    const rawTextProvider = new class implements vscode.TextDocumentContentProvider {
        onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
        onDidChange = this.onDidChangeEmitter.event;
        provideTextDocumentContent(uri: vscode.Uri): string {
            return uri.path;
        }
    }
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider("rawtext", rawTextProvider));

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with registerCommand
    // The commandId parameter must match the command field in package.json
    let disposable = vscode.commands.registerCommand('xopera-vscode-extension.deploycsar', async (zipFileUri) => {
        try {
            vscode.window.showInformationMessage('Hello World wawawa from xopera-vscode-extension!')

            vscode.window.showInformationMessage("Verifying auth.")
            const cookieJar = new CookieJar()
            await doLoginProcedure(cookieJar)

            SaasApi.defaultHeaders = {
                "cookie": jarToHeader(SaasApi.basePath, cookieJar)
            }
            console.log("default headers for saas now", SaasApi.defaultHeaders)


            console.log("hopefully authed ws request")
            const workspacesShouldBeAuthedResponse = await SaasApi.getWorkspaces()
            console.log("these should be wss", workspacesShouldBeAuthedResponse)
            if (!workspacesShouldBeAuthedResponse.body) {
                vscode.window.showInformationMessage("authentication didn't do its thing")
                console.error("authentication didn't do its thing")
                return
            }
            const workspaces = workspacesShouldBeAuthedResponse.body

            const workspaceSelectOptions: { [key: string]: Workspace | null } = {}
            workspaces.forEach(ws => {
                workspaceSelectOptions[ws.id + ": " + ws.name] = ws
            })
            workspaceSelectOptions["Create new workspace"] = null
            const chosenWorkspaceKey = await vscode.window.showQuickPick(Object.keys(workspaceSelectOptions), { canPickMany: false, ignoreFocusOut: true })
            if (chosenWorkspaceKey === undefined) {
                vscode.window.showInformationMessage("Deployment canceled, no chosen workspace.")
                console.error("Deployment canceled, no chosen workspace.")
                return
            }
            let chosenWorkspace = workspaceSelectOptions[chosenWorkspaceKey!!]
            if (chosenWorkspace === null) {
                const inputWorkspaceName = await vscode.window.showInputBox({
                    prompt: "Workspace name",
                    ignoreFocusOut: true
                })

                if (inputWorkspaceName === undefined) {
                    vscode.window.showErrorMessage("Deployment canceled, no workspace name.")
                    return
                }

                vscode.window.showInformationMessage("Creating workspace.")
                chosenWorkspace = (await SaasApi.createWorkspace(
                    // @ts-ignore
                    { name: inputWorkspaceName }
                )).body
            }

            const inputProjectName = await vscode.window.showInputBox({
                prompt: "Project name",
                ignoreFocusOut: true
            })
            if (inputProjectName === undefined) {
                vscode.window.showErrorMessage("Deployment canceled, no project name.")
                return
            }

            vscode.window.showInformationMessage(zipFileUri)
            console.log(zipFileUri)
            console.log(zipFileUri.toString())
            console.log(zipFileUri.toString().slice("file://".length))

            const zipBuffer = await fs.promises.readFile(zipFileUri.toString().slice("file://".length))
            const b64 = zipBuffer.toString("base64")
            // console.log(b64)


            vscode.window.showInformationMessage("Creating project.")
            const projectResponse = await SaasApi.createWorkspaceProject(
                // @ts-ignore
                {
                    name: inputProjectName ?? "come on static type checker this is impossible",
                    csar: b64
                },
                chosenWorkspace.id
            )
            const project = projectResponse.body
            vscode.window.showInformationMessage("Project created.")

            const deploymentChoices: { [key: string]: boolean; } = {
                "Deploy project": true,
                "Do not deploy project": false
            }
            let chosenDeploymentChoice = await vscode.window.showQuickPick(Object.keys(deploymentChoices), { canPickMany: false, ignoreFocusOut: true })
            if (chosenDeploymentChoice === undefined) {
                chosenDeploymentChoice = "Do not deploy project"
            }
            const userWantsDeployment = deploymentChoices[chosenDeploymentChoice]

            if (userWantsDeployment) {
                const serviceTemplateName = await vscode.window.showInputBox({
                    prompt: "Enter your service template filename",
                    ignoreFocusOut: true
                })
                if (serviceTemplateName === undefined) {
                    console.log("Deployment cancelled: no service template name.")
                    return
                }

                const inputsFileUri = await vscode.window.showOpenDialog({
                    canSelectFiles: true,
                    canSelectFolders: false,
                    canSelectMany: false,
                    title: "Deployment inputs",
                    filters: {
                        "Inputs": ["yml", "yaml"]
                    }
                })
                if (inputsFileUri === undefined) {
                    console.log("Deployment cancelled: no inputs file.")
                    return
                }
                const inputsBuffer = await fs.promises.readFile(inputsFileUri.toString().slice("file://".length))
                const inputsYamlString = inputsBuffer.toString("utf-8")
                console.log("Read inputs", inputsYamlString)
                const inputsYamlParsed = yaml.safeLoad(inputsYamlString)
                if (inputsYamlParsed === undefined) {
                    console.log("Deployment cancelled: failed to parse inputs.")
                    vscode.window.showErrorMessage("Deployment cancelled: failed to parse inputs.")
                    return
                }

                console.log("Deploying")
                vscode.window.showInformationMessage("Deploying project.")
                const result = await SaasApi.operaApiDeploy(chosenWorkspace.id, project.id, {
                    serviceTemplate: serviceTemplateName!!,
                    //@ts-ignore
                    inputs: inputsYamlParsed
                })
                vscode.window.showInformationMessage("Project successfully deployed.")

                const resultString = JSON.stringify(result.body, undefined, 4)
                await vscode.window.showTextDocument(vscode.Uri.parse("rawtext:" + resultString))
            }

            await vscode.env.openExternal(vscode.Uri.parse("https://xopera-radon.xlab.si/ui/"))
        } catch (e) {
            vscode.window.showErrorMessage("General error, see debug console.")
            console.error(e)
            return
        }
        console.log("Finally done.")
    });

    context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
export function deactivate() { }
