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

interface AuthProvider {
    href: string,
    text: string
}

const doCookieRequest = async (method: string, url: string, formData: object | undefined, cookieJar: CookieJar) => new Promise<IncomingMessage>((resolve, reject) => {
    console.log("doing " + method + " request to " + url)
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
                console.log("response for " + method + " url " + url, response)
                updateJar(url, cookieJar, response)
                resolve(response);
            } else {
                console.error(response)
                reject(new HttpError(response, response.statusCode));
            }
        }
    });
});

// may net strictly follow spec, but w/e
const doCookieRequestFollowRedirects: (method: string, url: string, formData: object | undefined, cookieJar: CookieJar) => Promise<IncomingMessage> = async (method: string, url: string, formData: object | undefined, cookieJar: CookieJar) => {
    console.log("follow redirects " + method + " request to " + url)
    const response = await doCookieRequest(method, url, formData, cookieJar)
    if (300 <= response.statusCode!! && response.statusCode!! <= 399) {
        let newMethod: string
        if (response.statusCode!! === 302 || response.statusCode!! === 303) {
            console.log(response.statusCode!!.toString() + " received, switching from " + method + " to GET")
            newMethod = "GET"
        } else {
            console.log(response.statusCode!!.toString() + " received, continuing with " + method)
            newMethod = method
        }

        console.log("following redirect to " + response.headers["location"]!!)
        return await doCookieRequestFollowRedirects(newMethod, response.headers["location"]!!, formData, cookieJar)
    }
    return response
}

const updateJar = (url: string, jar: CookieJar, response: IncomingMessage) => {
    const setCookieHeaders = response.headers['set-cookie']!!
    if (!setCookieHeaders) {
        console.debug("not updating jar, no set-cookie headers")
        return
    }
    console.debug("updating cookies from set-cookie " + setCookieHeaders.toString())
    const newCookies = setCookieHeaders.map(c => Cookie.parse(c)!!)
    newCookies.forEach(c => {
        jar.setCookie(c, url)
    })
    console.debug("updated jar", jar)
}

const jarToHeader = (url: string, jar: CookieJar) => {
    const cookies = jar.getCookiesSync(url).map(c => {
        return c.cookieString()
    })
    console.debug("rendering cookies", cookies)
    return cookies
}

const smartQuerySelectorAll = (doc: Document, query: string) => {
    const results: Element[] = []
    doc.querySelectorAll(query).forEach(i => {
        results.push(i)
    })
    return results
}

const getAuthProviders = (doc: Document, pageUrlString: string) => {
    console.log("getting auth providers")

    const authProviders: AuthProvider[] = []
    const authProviderElements = smartQuerySelectorAll(doc, "#kc-social-providers li a")
    authProviderElements.forEach(i => {
        authProviders.push({
            //@ts-ignore
            href: (new URL(i.href, pageUrlString)).href,
            text: i.firstElementChild?.textContent || "unknown provider"
        })
    })
    return authProviders
}

const doKeycloakLoginPage = async (cookieJar: CookieJar, page: Document, username: string, password: string) => {
    //@ts-ignore
    const actionUrl = page.querySelector("#kc-form-login").attributes["action"].value
    console.log("action url", actionUrl)

    return await doCookieRequestFollowRedirects(
        "POST",
        actionUrl,
        { "username": username, "password": password, "credentialId": "" },
        cookieJar
    )
}

const doLoginProcedure = async (cookieJar: CookieJar) => {
    let needsLogin = false

    console.log("LOGIN STEP 1: check")
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

    console.log("LOGIN STEP 2: request for oidc-radon")
    const redirectedAuthPageResponse = await doCookieRequestFollowRedirects(
        "GET",
        credsForAuthResponse.headers["location"]!!,
        undefined,
        cookieJar
    )

    //@ts-ignore
    const doc = new JSDOM(redirectedAuthPageResponse.body).window.document

    console.log("LOGIN STEP 3: getting auth providers")
    const authProviders = getAuthProviders(doc, credsForAuthResponse.headers["location"]!!)
    let chosenAuthProvider: AuthProvider | null
    if (authProviders.length === 0) {
        chosenAuthProvider = null
    } else {
        const authenticationMethodChoices: { [key: string]: AuthProvider | null } = {}
        authenticationMethodChoices["Log in as an XLAB native user"] = null
        authProviders.forEach(i => {authenticationMethodChoices[i.text] = i})

        const chosenAuthOptionKey = await vscode.window.showQuickPick(Object.keys(authenticationMethodChoices), { canPickMany: false, ignoreFocusOut: true })
        if (chosenAuthOptionKey === undefined) {
            vscode.window.showInformationMessage("Deployment canceled, no chosen workspace.")
            console.error("Deployment canceled, no chosen workspace.")
            throw new Error("Deployment canceled, no chosen workspace.");
        }
        chosenAuthProvider = authenticationMethodChoices[chosenAuthOptionKey]
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

    if (chosenAuthProvider === null) {
        console.log("LOGIN STEP 4a: native login")
        const loginFormSubmitResponse = await doKeycloakLoginPage(cookieJar, doc, inputUsername, inputPassword)
    } else {
        console.log("LOGIN STEP 4b-1: clicking on auth provider button link")
        const secondaryAuthProviderButtonResponse = await doCookieRequestFollowRedirects(
            "GET",
            chosenAuthProvider.href,
            undefined,
            cookieJar
        )

        //@ts-ignore
        const secondaryAuthProviderDoc = new JSDOM(secondaryAuthProviderButtonResponse.body).window.document
        console.log("LOGIN STEP 4b-2: submitting secondary auth provider login page")
        const secondaryAuthProviderloginFormSubmitResponse = await doKeycloakLoginPage(cookieJar, secondaryAuthProviderDoc, inputUsername, inputPassword)
    }

    console.log("LOGIN DONE!")
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
