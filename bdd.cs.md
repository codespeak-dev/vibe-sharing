# Vibe Sharing BDD Scenarios

## Feature: GitHub Repository Setup

### Scenario: Create and push new organisation repository
Given the user has the GitHub CLI installed and is in the local working directory
When the user runs the gh CLI commands to create a new repository under the codespeak-dev organisation and push the local directory
Then a repository named 'vibe-sharing' appears under codespeak-dev/vibe-sharing on GitHub

---

## Feature: Plan Validation

### Scenario: Gap analysis identifies missing concerns in a plan document
Given the user has a plan file for the vibe-share session export
When the user provides the plan file path and asks whether it covers all necessary concerns
Then a structured gap analysis is returned identifying regressions, missing features, unjustified design assumptions, and credibility gaps in privacy claims

---

## Feature: CLI Tool – Core Archive and Upload Flow

### Scenario: Tool detects git status and collects files automatically
Given the user is in a project directory under git version control
When the user runs the tool
Then the tool detects git status and collects the right files without the user needing to specify anything manually

### Scenario: Tool packages and uploads after user confirmation
Given the user has been shown the file list
When the user confirms the list
Then the tool packages all confirmed files into a zip and uploads the data automatically reporting progress and final result

### Scenario: Tool locates session files for non-Claude-Code agent
Given the user has a project that was not built with Claude Code
When the tool cannot find Claude Code sessions
Then the tool asks the user which AI agent they used and locates that agent's session files

### Scenario: Tool suggests candidate directories when session layout is unknown
Given the user's agent session directory layout is unknown to the tool
When the tool cannot find sessions through standard paths
Then the tool suggests candidate directories by searching for files referencing the project path rather than requiring the user to navigate blindly

### Scenario: Tool applies default exclusions for non-git directories
Given the user is running the tool in a directory not under git version control
When the tool starts
Then the tool applies default exclusions for common noise directories such as .venv, node_modules, and .env.local and lets the user adjust the list before packaging

### Scenario: Tool falls back to local zip when backend is unavailable
Given the user has no backend configured or the backend is unavailable
When the user attempts to share
Then the tool falls back to producing a local zip file the user can handle manually

### Scenario: Tool locates session files for Codex or Gemini automatically
Given the user has used Codex, Gemini, or another supported file-system-based agent
When the tool searches for session files
Then the tool locates that agent's session files automatically

### Scenario: Tool offers file system browser for unsupported agent
Given the user has used an agent that is not supported by the tool
When the tool cannot find session files automatically
Then the tool offers a file system browser to locate session files rather than failing or asking the user to type a path

### Scenario: Tool displays privacy notice before any action
Given the user runs the tool for the first time
When the tool starts
Then a clear privacy notice is shown explaining what will be shared and why before any action is taken and the user must give explicit consent to proceed

### Scenario: Tool runs without platform-specific setup
Given the user is on Windows, macOS, or Linux
When the user runs the tool
Then the tool runs without requiring platform-specific setup or installation steps

---

## Feature: Claude Code Plugin – Archive Creation

### Scenario: User installs plugin and it becomes available
Given the user has a Claude Code environment
When the user installs the plugin
Then the plugin becomes available for use in their projects

### Scenario: Plugin packages sessions and project context into a zip
Given the user has invoked the plugin from a project directory
When the plugin runs
Then it locates relevant Claude Code session files and packages them with project context into a zip archive

### Scenario: User sees reassuring message at archive creation start
Given the user has started archive creation
When the archive creation process begins
Then a clear, reassuring message is displayed explaining what will happen, that secrets are protected with a '(best effort)' qualifier, and that the user can review contents afterward

### Scenario: User can inspect everything included in the zip after creation
Given the user has completed archive creation
When the archive is ready
Then the user can easily inspect everything included in the zip

### Scenario: User is prompted for explicit consent via interactive question
Given the user has reached the consent step of archive creation
When the consent prompt is shown
Then the user is prompted via an interactive question tool and can explicitly confirm or decline before any packaging proceeds

### Scenario: Slash command locates installed plugin script and runs scan mode
Given the user has the plugin installed
When the user invokes the /vibe-sharing:vibe-share slash command
Then the command locates the installed plugin script and runs the --scan mode without error

### Scenario: Running claude with plugin-dir flag executes the command
Given the user is in a project directory
When the user runs 'claude --plugin-dir . "/vibe-share"'
Then Claude Code opens and executes the vibe-share command rather than opening an idle session with no command invoked

### Scenario: Archive includes a recursive file tree of the project directory
Given the user has run vibe-share on their project
When the archive is created
Then it contains a text file with the recursive file tree of the project directory alongside Claude Code session files

### Scenario: Sensitive keys in session files are masked before archiving
Given the user runs vibe-share
When session files are packaged
Then sensitive keys in session files are masked so that raw secret values are never included in the zip

### Scenario: Secrets protection message includes best effort qualifier
Given the user runs vibe-share
When the upfront message is displayed
Then it includes a '(best effort)' qualifier so that expectations about the limits of protection are set accurately

### Scenario: Subagent sessions are included in the archive
Given the user runs vibe-share on a project with subagent sessions
When the archive is created
Then subagent sessions are included in the archive alongside top-level sessions so the full conversation history is captured

### Scenario: Plan files mentioned in sessions are copied into the archive
Given the user runs vibe-share
When the archive is built
Then all plan files mentioned anywhere in any session including subagent sessions are copied into the archive

### Scenario: Debug session files from .claude/debug/ are included in the archive
Given the user runs vibe-share
When the archive is built
Then debug session files from ~/.claude/debug/ are included in the archive output

### Scenario: Archive contains comparable depth of session history to other projects
Given the user compares the archived session history to other projects on the same system
When the archive is created
Then it contains comparable depth of history

### Scenario: Scan mode reports counts of sessions, plans, and debug files
Given the user runs vibe-share in scan mode
When scan completes
Then the system reports counts of session transcripts, plan files, and debug files present in the project

### Scenario: Build mode packages all referenced sessions, plans, and debug files
Given the user runs vibe-share in build mode
When build completes
Then the system collects all referenced sessions, plans, and debug files and packages them into a zip archive with a build report

### Scenario: Review mode previews zip archive contents
Given the user runs vibe-share in review mode
When review mode executes
Then the system previews the contents of the packaged zip archive

### Scenario: REQUIREMENTS.md is copied to the intent/ directory
Given the user copies the REQUIREMENTS.md plan file
When the copy operation is performed
Then the requirements document is stored at the intent/ directory path

---

## Feature: Session Log Extraction

### Scenario: Extraction script regenerates combined and per-session output files
Given the extraction script has been saved to disk
When the user runs the saved extraction script
Then intent/msg-and-answers.md and the per-session files in intent/sessions/ are regenerated with current session log content, all containing entries in chronological order separated by ========== dividers

---

## Feature: Console UI Gratitude Animation

### Scenario: Gratitude frames cycle when user scrolls through menu options
Given the user is on a checkbox or select prompt
When the user scrolls through menu options using arrow keys, space, or number keys
Then gratitude-themed pseudographic frames cycle or advance in the bottom-left corner of the screen

### Scenario: Gratitude animation disappears on Enter confirmation
Given the user is viewing a prompt with the gratitude animation active
When the user confirms a selection with Enter
Then the gratitude animation disappears and the normal completion summary is shown

---

## Feature: Backend Infrastructure (AWS CDK)

### Scenario: User deploys and manages backend without using AWS console
Given the user has the AWS CDK CLI installed and configured
When the user runs CLI commands to deploy, configure, and manage the backend
Then the backend is provisioned and configured without touching the AWS console

### Scenario: User uploads files up to 5GB via presigned URL
Given the backend is deployed
When the user uploads files up to 5GB through the secure presigned URL flow
Then the files are stored securely in S3

### Scenario: User submits optional reporter metadata with upload
Given the backend is deployed with a presign Lambda function
When the user submits optional reporter metadata including email, name, and repo URL as part of the presign request
Then the metadata is stored alongside the upload in DynamoDB

### Scenario: User installs CDK dependencies and initializes a CDK project
Given the user has no prior infrastructure tooling in place
When the user installs CDK dependencies and initializes a CDK project from the command line
Then the CDK project is ready for stack definition

### Scenario: User configures AWS credentials via SSO and bootstraps CDK
Given the user has set up AWS credentials via SSO
When the user confirms this is sufficient and runs CDK bootstrap and deployment commands
Then CDK commands work with SSO credentials

### Scenario: CDK bootstrap fails when run outside a directory with cdk.json
Given the user has navigated to the backend directory which lacks a cdk.json file
When the user runs npx cdk bootstrap without an explicit environment argument
Then the bootstrap fails with an environment resolution error

### Scenario: Plan file is stored in intent/app/ directory
Given the user copies the plan file
When it is placed at the intent/app/ directory
Then the plan file is stored at that path for ongoing reference

### Scenario: backend/README.md provides clear setup and usage instructions
Given the user reads backend/README.md
When they open the file
Then they find clear instructions for working with the backend

### Scenario: CLI connects to a custom backend via VIBE_SHARING_API_URL
Given the user wants to test against a deployed API Gateway URL
When the user sets VIBE_SHARING_API_URL to a custom URL and runs the CLI tool
Then the CLI connects to the specified backend for that session

---

## Feature: Backend Security Hardening

### Scenario: Security review identifies weaknesses and resource isolation
Given the user requests a security review of the back-end
When the review is performed
Then a report of weaknesses is produced and an explanation of how AWS resource isolation is structured is provided

### Scenario: User makes per-issue decisions before any remediation is applied
Given the security review has produced a list of issues
When the user reviews each security issue
Then the user provides a decision per issue and the system proceeds with remediation only for issues the user chose to address

### Scenario: User enables PITR and skips error message remediation
Given the user is reviewing security issues interactively
When the user enables PITR for DynamoDB and skips generic error message remediation
Then PITR is scheduled for implementation and error message changes are deferred

### Scenario: CloudWatch alarms with SNS notifications become active
Given the user has requested monitoring and alerting
When the user enables CloudWatch alarms with SNS notifications
Then monitoring and alerting is active for abuse and error conditions

### Scenario: User receives alarm notification emails at alarms@codespeak.dev
Given CloudWatch alarms are configured with SNS email subscription
When an alarm fires
Then the operations team receives an alert email at alarms@codespeak.dev in real time

### Scenario: User updates alarms email via a single config file entry
Given the alarms email address is defined in a central configuration file
When the user changes the email address in that file
Then the configuration change is applied without searching for hardcoded strings in the stack

### Scenario: User receives Slack notification when a CloudWatch alarm fires
Given the Slack webhook Lambda is subscribed to the SNS alarms topic
When a CloudWatch alarm fires
Then the team receives a Slack message in the configured channel

### Scenario: Slack Lambda retrieves webhook URL from SSM Parameter Store
Given the user has stored the Slack webhook URL value in SSM Parameter Store at /vibe-share/slack-webhook-url
When the Lambda is invoked
Then it retrieves and uses the webhook URL to post alarm notifications to the configured Slack channel

### Scenario: User reads README and learns about SSM parameter requirement
Given the user reads the README before deploying
When they review the deployment instructions
Then they know to create the SSM parameter with the Slack webhook URL before the Lambda can function

### Scenario: Security changes are reviewed for gaps and mistakes
Given the user requests a review of all uncommitted changes
When the review is performed
Then a summary is provided indicating which security concerns are addressed, what gaps remain, and any mistakes found

### Scenario: User rotates Slack webhook URL and Lambda picks it up within 5 minutes
Given the Slack webhook Lambda caches the SSM webhook URL with a 5-minute TTL
When the user rotates the Slack webhook URL in SSM Parameter Store
Then the Lambda picks up the new URL within 5 minutes without requiring a redeploy

### Scenario: Recovery notification is sent when a CloudWatch alarm clears
Given CloudWatch alarms are configured with both alarm and OK actions
When the user resolves an infrastructure incident that triggered an alarm
Then the team receives an OK recovery notification confirming the alarm has cleared

### Scenario: SNS retries Slack Lambda when Slack is unavailable
Given the Slack webhook Lambda throws on delivery failure
When Slack is experiencing an outage when an alarm fires
Then the Lambda throws an error and SNS retries delivery rather than recording silent success

### Scenario: AWS_PROFILE is set automatically on directory entry via direnv
Given direnv is installed and the .envrc file sets AWS_PROFILE to 'default'
When the user enters the project directory
Then AWS_PROFILE is automatically set to 'default' without manual sourcing or flags
And when the user leaves the project directory AWS_PROFILE is unset so other projects are not affected

### Scenario: Team receives Slack notification when upload is requested
Given the presign Lambda publishes to the upload events SNS topic
When the user submits a presign request via the CLI
Then the team receives a Slack notification that a new upload has been requested including filename, size, IP, and user info

### Scenario: Team receives Slack notification when upload is confirmed
Given the confirm Lambda publishes to the upload events SNS topic
When the user completes a file upload and the confirm endpoint validates it successfully
Then the team receives a Slack notification confirming the upload including filename, size, and share URL

### Scenario: Team receives Slack notification when upload fails
Given the confirm Lambda detects the file is missing from S3
When the user attempts an upload that fails
Then the team receives a Slack notification indicating the upload failed

---

## Feature: DynamoDB and SSM Configuration

### Scenario: User considers alarm email storage and decides to keep it in config
Given the user is evaluating whether to store the alarm email in SSM or in config
When the user makes a decision
Then the email is classified as non-sensitive and remains in the config file while the Slack webhook stays in SSM

---

## Feature: CLI Error Observability and Telemetry

### Scenario: Developer is notified automatically when user encounters CLI failure
Given the CLI automatically sends error telemetry to the backend on failure
When the user encounters a CLI failure
Then the developer is automatically notified via telemetry without waiting for the user to report it

### Scenario: Developer uses correlation ID to trace a full request journey
Given the CLI generates a correlation ID that flows through all upload steps
When the user reports an issue
Then the developer uses the correlation ID from logs to trace the full request journey across CLI and backend

### Scenario: Developer reconstructs context from local diagnostic log
Given the CLI writes a local diagnostic log file on every run
When the developer investigates a client-side failure
Then the developer can reconstruct context from the local diagnostic log file the user shares

---

## Feature: CLI User Identity and Upload Improvements

### Scenario: CLI pre-populates email and username from git config
Given the user's git config has email and username set
When the user runs the CLI app
Then the app uses the git config values without prompting for them

### Scenario: CLI prompts for email and username when git config is absent
Given the user's git config does not have email or username set
When the user runs the CLI app
Then the app prompts the user to enter email and username manually

### Scenario: Upload failure shows step-aware error with recovery suggestions
Given the user has completed archive creation, consent, and repo URL steps
When the upload fails at the confirm step
Then the CLI displays a step-aware error message indicating the confirm step failed along with --output and --verbose flag suggestions

### Scenario: Verbose flag displays full error cause chain
Given the upload has previously failed at the confirm step
When the user re-runs the upload with the --verbose flag
Then the CLI displays the full cause chain including HTTP status code and backend response body

### Scenario: cdk-deploy script runs deployment with auto-approve automatically
Given the cdk-deploy script exists in the scripts/ directory
When the user runs cdk-deploy from the scripts directory
Then CDK deployment executes with auto-approve behavior without the user needing to specify any flags manually

---

## Feature: Sharing Consent Default

### Scenario: User presses Enter on consent prompt and sharing is accepted by default
Given the user launches the CLI app and encounters the sharing consent prompt
When the user presses Enter without changing the selection
Then consent sharing is accepted because the default selection is 'Y'

---

## Feature: Presigned Share URLs

### Scenario: User receives a working presigned S3 GET URL after upload
Given the confirm endpoint has been updated to return a presigned S3 GET URL with 7-day expiry
When the user completes an upload
Then a presigned S3 GET URL is displayed that can be opened in a browser to access the uploaded content

---

## Feature: Upload Status and Maintenance Scripts

### Scenario: status.sh displays all upload records in a formatted table
Given upload records exist in DynamoDB
When the user runs status.sh
Then a formatted table is printed showing all upload records with upload ID, status, filename, size, creation timestamp, confirmation timestamp or dash if absent, repository URL, submitter name, and email

### Scenario: direnv adds scripts directory to PATH on entry
Given direnv is installed and .envrc adds the scripts directory to PATH
When the user navigates to the project directory
Then direnv loads .envrc and the user can run status.sh directly as a command without specifying the full path

### Scenario: status.sh displays records without fetching lambda logs by default
Given upload records exist in DynamoDB
When the user runs status.sh without the --logs flag
Then upload record states are displayed without fetching lambda logs

### Scenario: status.sh fetches lambda logs when --logs flag is provided
Given upload records exist in DynamoDB
When the user runs status.sh with the --logs flag
Then upload record states are displayed along with lambda logs

### Scenario: clear-uploads script requires explicit phrase before deleting
Given DynamoDB records and S3 objects exist
When the user runs the clear-uploads script, sees the count of items to be deleted, and types 'delete all' at the confirmation prompt
Then all DynamoDB records and S3 objects are deleted leaving both stores empty

---

## Feature: Custom Domain and Zero-Configuration CLI

### Scenario: Tool launches and uploads without any configuration
Given the CLI tool has a default server URL of https://vibe-share.codespeak.dev
When the user runs 'npx codespeak-vibe-share'
Then the tool launches and is ready to upload without any configuration step

### Scenario: Upload succeeds without the user providing a server URL
Given the CLI defaults to https://vibe-share.codespeak.dev
When the user uploads files
Then the upload succeeds without the user having provided a server URL

### Scenario: User adds ACM DNS validation CNAME and certificate validates
Given the user has received DNS record instructions for vibe-share.codespeak.dev
When the user adds the ACM DNS validation CNAME record at their registrar
Then the certificate validates and vibe-share.codespeak.dev resolves to the API Gateway endpoint

### Scenario: Application responds from a third-party machine via the public domain
Given the custom domain is configured and DNS has propagated
When the user accesses the application from a third-party machine using https://vibe-share.codespeak.dev
Then the application responds successfully

### Scenario: Public accessibility verified via curl from external machine
Given the custom domain is fully deployed and DNS is resolving
When the user runs curl https://vibe-share.codespeak.dev/health from an external machine
Then a successful response is returned

---

## Feature: Git-Managed Project Packaging

### Scenario: Tool produces structured package for a git project
Given the user is in a Git-managed project directory
When the user runs the CLI tool
Then the tool produces a structured package containing git status, two separate git diff files for unstaged and versus HEAD, file listing, untracked files, a git bundle, and any referenced plan or debug session files including tool-results/ and subagents/ directories

### Scenario: Browser file system option for sessions functions correctly
Given the user is in the session setup UI
When the user selects the browser file system option for sessions
Then the feature functions as expected without errors or failures

### Scenario: User shares individual untracked files from session setup UI
Given the user is in the session setup UI
When the user is prompted and selects individual untracked files to share
Then those files are included in the session context

### Scenario: Archive sessions directory replicates local .claude folder structure
Given the user has run the CLI tool and an archive has been created
When the user unzips the archive
Then they find sessions/.claude/ replicating the local .claude folder structure with project files, plans, and debug sessions in their expected locations

### Scenario: Archive is identifiable by repository or folder name
Given the user has run the CLI tool and an archive has been created
When the user opens their downloads or output folder
Then they can identify the archive by its repository or folder name without opening it

---

## Feature: Web UI – File Browsing and Authentication

### Scenario: User is prompted to authenticate before accessing files
Given the web UI is deployed with Cognito authentication
When the user visits the web UI
Then they are prompted to authenticate before accessing files

### Scenario: Authenticated user can list and download files
Given the user has valid Cognito credentials
When the user authenticates successfully
Then they gain access to the list of uploaded files and can download them

### Scenario: Adding a team member grants access to files
Given the Cognito user pool is active
When the user adds a new team member to the Cognito user pool
Then that member gains access to the file browsing and download interface

### Scenario: Removing a team member revokes access
Given a team member exists in the Cognito user pool
When the user removes that team member
Then that member loses access to files

### Scenario: CDK stack deploys successfully with live infrastructure
Given the CDK stack has been defined with all required resources
When the user deploys the CDK stack
Then the stack completes successfully and outputs live infrastructure URLs and identifiers

### Scenario: Updating config.js with stack outputs makes the web UI functional
Given the stack has been deployed and outputs are available
When the user copies CognitoClientId and WebUiUrl from stack outputs into config.js
Then the web UI becomes functional with correct OAuth configuration

### Scenario: Updating Cognito callback URLs to CloudFront domain fixes OAuth flow
Given the Cognito client callback URLs need to be updated
When the user updates them to the CloudFront domain
Then the OAuth login flow completes without callback URL mismatch errors

### Scenario: User creation script creates a user who can authenticate
Given the Cognito user pool is active
When the user runs the user creation script with a username and password
Then a new user is created in the Cognito user pool and can authenticate via OAuth login at the CloudFront-hosted web UI

### Scenario: User with codespeak.dev email self-registers without admin intervention
Given the Cognito user pool allows self-registration for @codespeak.dev addresses
When a user with a @codespeak.dev email address attempts to self-register via the Cognito login page
Then the registration succeeds without requiring admin intervention

### Scenario: User sets permanent password after receiving temporary password
Given the user has been created and received a temporary password via email
When the user logs in for the first time
Then they receive a temporary password via email and must set a permanent password

### Scenario: UI displays authenticated user's email and repository URL
Given the user is authenticated and viewing the web UI
When the user views the UI
Then their email address and the repository URL associated with the session are displayed

### Scenario: GitHub URLs in any common format render as correct user/repo links
Given the user's repository remote is configured with any common GitHub URL format
When the user views the UI
Then a correctly shortened 'user/repo' label is displayed linking to the correct GitHub repository page

### Scenario: Application loads at admin.vibe-share.codespeak.dev
Given the CloudFront distribution is configured for the custom domain
When the user navigates to admin.vibe-share.codespeak.dev
Then the application loads correctly

### Scenario: User requests and validates ACM certificate for custom domain
Given the CloudFront distribution requires a certificate in us-east-1
When the user runs AWS CLI commands to request the ACM certificate in us-east-1 and adds the CNAME DNS validation record at their registrar
Then validation completes and the certificate ARN can be provided to continue the CDK stack update

---

## Feature: Web UI – Internal Emails Management

### Scenario: Internal emails are hidden from main table by default
Given some user emails have been flagged as internal
When the user views the main table
Then internal emails are hidden by default

### Scenario: Show internal checkbox makes internal emails visible
Given the user is viewing the main table with internal emails hidden
When the user checks the 'show internal' checkbox
Then internal emails become visible in the table

### Scenario: Mark-as-internal button flags an email from the table row
Given the user is viewing the main table
When the user clicks the mark-as-internal button on a row
Then that email is flagged as internal and hidden on the next default load

### Scenario: Internal emails management page allows adding emails to the list
Given the dedicated internal emails management page exists
When the user navigates to it and adds an email
Then the email is added to the internal list

### Scenario: Show internal uploads preference persists across sessions
Given the user has enabled the 'Show internal uploads' checkbox
When the user applies the filter and returns to the page on a subsequent visit
Then the checkbox remains checked reflecting the saved preference

### Scenario: Hide internal uploads preference persists across sessions
Given the user has disabled the 'Show internal uploads' checkbox
When the user applies the filter and returns to the page on a subsequent visit
Then the checkbox remains unchecked reflecting the saved preference

---

## Feature: CLAUDE.md Git Root Detection

### Scenario: Claude Code identifies git repository root when run from subfolder
Given the user is in a subfolder within a git repository
When the user runs the Claude Code CLI
Then Claude Code correctly identifies the git repository root as the project root and resolves CLAUDE.md accordingly

---

## Feature: Worktree-Based Session Discovery

### Scenario: Sessions from original repo are discovered when launching from a worktree
Given the user has launched the tool from a git worktree
When the tool runs session discovery
Then sessions stored in the original repo directory are discovered and shown

### Scenario: Sessions from all worktrees are collected in a unified list
Given the user has multiple worktrees for a repository
When the tool runs session discovery
Then sessions from all worktrees are collected and presented in a unified list

---

## Feature: Git Bundle Failure Graceful Degradation

### Scenario: Tool processes files even when no git commits exist
Given the user is running the tool on a project with no git commits
When the tool runs
Then it still processes and includes the files present in the repo directory rather than skipping them

### Scenario: Tool handles a non-git directory gracefully
Given the user is running the tool on a project directory not under git version control
When the tool runs
Then it handles the project gracefully without requiring git

### Scenario: Upload flow skips repo URL prompt when no git remotes exist
Given the project directory has no git remotes configured
When the user runs the upload flow
Then the repo URL prompt is skipped entirely

### Scenario: Upload success message does not display a download URL
Given the user completes an upload successfully
When the upload finishes
Then no download URL line is shown in the success output

---

## Feature: Slack Notifications – Enriched and Threaded

### Scenario: Slack notification includes user name, email, and repo URL
Given a user submits a repository for processing
When the Slack notification is sent
Then it shows the user's name, email, and repo URL in the top-level message

### Scenario: Stage updates are posted as threaded replies
Given a user's processing progresses through multiple stages
When each stage update is sent
Then each update is posted as a threaded reply under the original Slack message rather than appearing as a new top-level message

### Scenario: Download link is appended to top-level message when processing completes
Given a user's processing has completed
When the completion notification is sent
Then a download link is appended to the original top-level Slack message

### Scenario: Clicking download link authenticates via Cognito and starts download
Given the user has received a Slack notification with a download link
When the user clicks the link
Then they are prompted for Cognito login if not already authenticated and the download begins automatically without further interaction

### Scenario: Email alert is sent when a Slack notification fails
Given a file has been uploaded
When the Slack notification fails
Then an email alert is sent notifying of the failed Slack operation

### Scenario: Lambda invalidates cached token immediately on error
Given a file has been uploaded and the Slack notification fails due to an invalid token
When the error response is received
Then the Lambda invalidates the cached token on error allowing recovery on the next invocation without waiting for the cache TTL

### Scenario: Upload notification shows human-readable summary with JSON in thread
Given a file upload event has occurred
When the user receives the Slack notification
Then they see a plain-language summary as the top-level message and can expand the thread to view detailed structured JSON

### Scenario: Each upload creates its own independent Slack thread
Given multiple file upload notifications are sent
When the notifications arrive in Slack
Then each upload appears as a separate top-level message with its own dedicated thread rather than all uploads being replies within one shared thread

---

## Feature: Internal Upload Badges and Styling

### Scenario: Internal upload notification in Slack shows codespeak emoji prefix
Given a file has been uploaded by an internal user
When the top-level Slack thread message is sent
Then it appears prefixed with the :codespeak: emoji distinguishing it from external uploads

---

## Feature: npm Package Publishing

### Scenario: User runs npx with scoped package name and tool executes
Given the package has been published to the npm registry under @codespeak/vibe-share
When the user runs 'npx @codespeak/vibe-share' in any terminal
Then the CLI tool downloads and executes without requiring a prior install step

### Scenario: Globally installed scoped package retains existing bin command name
Given the user installs the scoped package globally
When the user uses the bin command
Then the command name remains 'codespeak-vibe-share' for global install invocations

### Scenario: npm pack dry-run confirms only dist/ files are included
Given the package has been configured with a files field restricting to dist/
When the user runs 'npm pack --dry-run'
Then only dist/ files are listed as included in the package

### Scenario: npx --version confirms package installs and executes after publishing
Given the package has been published to npm
When the user runs 'npx codespeak-vibe-share --version'
Then the package installs and the version output is displayed confirming successful execution

---

## Feature: Email Verification and SES Integration

### Scenario: User must verify email before account becomes active
Given a new user signs up with an email address
When the sign-up is submitted
Then they receive a verification email and must confirm it before their account is active

### Scenario: User receives and completes password recovery via email
Given a user has a verified Cognito account
When the user requests a password recovery email
Then they receive the email and can complete the password reset flow

---

## Feature: Archive Size Estimation

### Scenario: Archive size estimate includes project file sizes
Given the user has run the tool on a project
When the archive size is estimated
Then the estimate accounts for all content including session data and project files and is not dramatically underestimated

---

## Feature: Lambda Runtime Upgrade

### Scenario: User upgrades all Lambda functions to Node.js 22.x
Given the user has received an AWS Health notification about Node.js 20.x end of life
When the user confirms Node.js 22.x as the target version and Claude applies the runtime replacement
Then all 4 Lambda definitions are updated and the user can proceed with deployment

---

## Feature: Cursor Session Bundling

### Scenario: User bundles Cursor project with plans created via IDE UI
Given the user has a Cursor project with plans created via the Cursor IDE UI
When the user bundles the project
Then those plans are discovered via the composer.planRegistry in state.vscdb, linked to sessions through composerId matching, their .md files are included in the archive, and the relevant state.vscdb registry data is preserved in the archive

### Scenario: User selects store.db copy approach for Cursor session data
Given the user has been presented with database reading options for Cursor session bundling
When the user selects the recommended store.db copy approach
Then Cursor session data is bundled as intact SQLite files in the project archive

### Scenario: Multiple real Cursor projects with agent transcripts are discovered for test coverage
Given the user has an extensive history of Cursor agent use across multiple projects
When the tool scans for projects
Then several projects are identified containing agent transcripts with plans referenced directly from sessions providing real test cases

---

## Feature: CLI Redesign – Project List and Review

### Scenario: Project List shows all discovered projects with agents and actions
Given the user runs the CLI from any directory
When the Project List screen appears
Then the user is greeted by first name from git config and sees all projects with their associated agents and per-project actions

### Scenario: Selecting Share shows project stats and asks to confirm sharing
Given the user is on the Project List screen
When the user selects Share on a project
Then they see full project stats and are asked whether to share

### Scenario: User can browse sessions, files, and git history before sharing
Given the user has chosen Review Before Sharing
When the review screen is open
Then the user can browse agent sessions, navigate the file tree with Not Shared files marked, and view git branches and commits before deciding to share

### Scenario: User confirms on consent screen and project is uploaded
Given the user has reviewed everything and is on the consent screen
When the user confirms
Then the project is zipped and uploaded

### Scenario: Escape on any screen with a back action returns to previous screen
Given the user is on any screen that has a back action
When the user presses Escape
Then they are returned to the previous screen

### Scenario: Pressing Enter on a session opens the session content
Given the user is on the Review screen with a session list visible
When the user presses Enter on a session
Then the session content is previewed

### Scenario: Pressing Esc while previewing a file returns to the Files tab
Given the user has opened a file preview on the Review screen
When the user presses Esc
Then they are returned to the Files tab of the Preview screen rather than to the Share Project screen

### Scenario: Claude session first messages display without ide tags
Given the user views a Claude session on the Review screen
When the first message is rendered
Then it is shown without <ide_*> tags

### Scenario: Welcome header appears when Share Project is the first screen
Given the user opens the CLI for the first time
When they land on the Share Project screen
Then a welcome header greets them

### Scenario: Enter confirms consent and Esc is visible secondary action on consent screen
Given the user has reached the consent screen
When the screen is displayed
Then Enter is the prominent confirm action and Esc is a visible but secondary action

### Scenario: Thank You box shows deletion footnote and Share Another is default
Given the user has completed a share
When the post-share screen is shown
Then the Thank You box is shown with deletion instructions as a footnote below it and Share Another is the default highlighted action

### Scenario: Session with empty name displays messages if they exist
Given a session exists with an empty name
When the user opens the session
Then the session messages are displayed

### Scenario: Projects are sorted by total session count descending
Given the user views the project list
When the list is rendered
Then projects are sorted by total session count in descending order

### Scenario: Project Share screen shows worktree count and total session count
Given the user views the Project Share screen for a project with multiple worktrees
When the screen is rendered
Then the worktree count and session count reflecting all worktrees are displayed

### Scenario: Project List includes a Share another project option
Given one or more projects have already been shared
When the user views the Project List screen
Then the heading reads 'Share another project:' and the option is available

### Scenario: Worktree entries for the same repo are merged into a single list entry
Given a project has multiple worktrees previously listed separately
When the user views the project list
Then a single unified entry is shown with combined agent lists and aggregated session counts

### Scenario: Tab cycles focus between tabs, list, and action buttons on review screen
Given the user is on the review screen
When the user presses Tab
Then focus cycles from tab bar to content area to action buttons and back

### Scenario: Shift+Enter opens the highlighted session without triggering other actions
Given the user has highlighted a session in the content list on the review screen
When the user presses Shift+Enter
Then the session opens without accidentally triggering Share or Back buttons

### Scenario: Subfolders with their own git roots appear as distinct project entries
Given a parent directory contains subfolders each with their own .git root
When the user opens the project list
Then each subfolder with its own .git root appears as a distinct project entry

### Scenario: Project list scrolls when entries exceed visible terminal height
Given the project list contains more entries than the visible terminal height
When the user views the project list
Then they can scroll through all entries without any being cut off or hidden

### Scenario: Down arrow from tabs zone moves focus to content list
Given the user is on the review screen with focus in the tabs zone
When the user presses the down arrow
Then focus moves to the content list zone so the user can immediately navigate list items

### Scenario: Content list shows visible highlight when focused
Given the user has navigated focus to the content list zone on the review screen
When the content zone becomes focused
Then the list displays a visible highlight indicating it is the active focused zone

### Scenario: Navigating up from top of content list moves focus to tabs
Given the user is on the review screen with focus in the content list at the top
When the user presses up
Then focus moves to the top menu/tabs area

### Scenario: Navigating down from bottom of content list moves focus to actions
Given the user is on the review screen with focus in the content list at the bottom
When the user presses down
Then focus moves to the bottom actions area

### Scenario: Progress bar displays during long-running operations
Given the user triggers a long-running operation
When the operation is in progress
Then a progress bar is displayed for the duration of the operation

### Scenario: Application opens with current directory project pre-selected
Given the user's current working directory is located under one of the directories in the project list
When the application opens
Then the project list opens with that project marked as '(current dir)' and pre-selected at the top of the list

### Scenario: Application opens normally when current directory matches no project
Given the user's current working directory is unrelated to any listed project
When the application opens
Then the project list opens normally with no project marked as current dir

---

## Feature: CLI Redesign – Sessions Tab with Feature Flag

### Scenario: Sessions tab shows static agent list when preview is disabled
Given the sessions preview feature flag is disabled
When the user views the review screen
Then a single Sessions tab appears showing agent names and session counts as a static list

### Scenario: Sessions tab shows interactive agent list when preview is enabled
Given the sessions preview feature flag is enabled
When the user views the review screen
Then a single Sessions tab appears and selecting an agent drills into a full interactive agent tab with session preview

### Scenario: Sessions tab is not shown when project has no agents
Given the user views a project with no agents
When the review screen is opened
Then the Sessions tab is not shown

---

## Feature: Review Screen – Project Path Display and Session Counts

### Scenario: Project path is always visible at top of review screen
Given the user opens the review screen for any project
When the screen is displayed
Then the project path is visible at the top of the screen without any additional action required

### Scenario: Session count in tab label matches session list count
Given the user opens the review screen for a project
When the screen first displays
Then the session count shown in the tab label matches the number of sessions visible in the session list from the moment the tab is first displayed

### Scenario: Cursor sessions appear in the session list for relevant projects
Given the user opens the review screen for a project that has Cursor sessions
When the Sessions tab loads
Then Cursor sessions appear in the session list

---

## Feature: CLI Redesign – Minimal Terminal-Fit UI

### Scenario: Collection begins with progress bar and no-data-sent message
Given the user has launched the tool
When collection begins
Then the user sees a progress bar and status messages confirming no data is sent to CodeSpeak during collection

### Scenario: User selects a project from the table using arrow keys and Enter
Given the user is viewing the project list table
When the user uses arrow keys to highlight a project and presses Enter
Then the project is selected and the project summary screen opens

### Scenario: Share flow completes and returns user to project list
Given the user is on the project summary screen and has pressed Enter on the Share button
When the consent screen appears and the user consents
Then the share completes and the user is returned to the project list

### Scenario: Make a zip creates archive and opens directory browser
Given the user is on the project summary screen
When the user navigates to 'Make a zip' and presses Enter
Then the zip is created and a directory browser opens showing zip contents with up/down navigation keys available

### Scenario: Share from zip contents screen runs share flow
Given the user is on the zip contents screen
When the user navigates to Share and presses Enter
Then the share flow runs

### Scenario: Exit from zip contents screen closes application
Given the user is on the zip contents screen
When the user navigates to Exit and presses Enter
Then the application closes

---

## Feature: Session Viewer – Project and Session List

### Scenario: User sees all sessions grouped by project
Given the session viewer is open
When the user views the main page
Then all discovered sessions are listed and grouped by project

### Scenario: Session preview shows ai-title when available
Given a session contains an ai-title entry with an aiTitle field
When the user views the session summary in the list
Then the aiTitle value is shown as the preview text

### Scenario: Session preview falls back to user messages when no ai-title
Given a session does not contain an ai-title entry
When the user views the session summary
Then the preview shows the first lines of user messages plus user message count and agent summary content

### Scenario: Opening a session shows every JSON object in order
Given the user has opened a session
When the session detail page loads
Then they see the complete ordered sequence of every JSON object in that session

### Scenario: JSON view shows formatted syntax-highlighted JSON with collapsed long strings
Given the user is viewing a JSON object in raw mode
When the raw view is active
Then formatted and highlighted JSON is shown with long strings collapsed to ellipsis

### Scenario: Clicking a truncated string reveals its full content
Given the user is viewing formatted JSON with a truncated long string
When the user clicks the truncated string
Then the full unescaped multiline value is shown

### Scenario: Rendered view shows message type and contents for recognised types
Given the user is viewing a JSON object in rendered mode
When the type is recognised
Then the message type and rendered contents are displayed

### Scenario: Rendered view is not available for unrecognised message types
Given the user is viewing a JSON object of an unrecognised type
When the user looks for the rendered view option
Then the rendered view option is not available

### Scenario: Large session entries load incrementally via pagination
Given the user opens a large session
When the session detail page loads
Then entries are loaded incrementally in pages via the API rather than all at once

### Scenario: Project card shows only session count pill with no agent badge
Given the user views the project list
When each project card is rendered
Then only the session count pill appears in the top-right area with no agent badge present

---

## Feature: Session Viewer – Collapsed Cards and Grouping

### Scenario: Type badge appears exactly once per message in the card header
Given the user views a session page
When the messages are rendered
Then each message's type badge appears exactly once in the EntryCard header

### Scenario: ai-title card displays title in header with no body
Given the session contains an ai-title message
When the card is rendered
Then the title appears in the card header and no card body is shown

### Scenario: FileSnapshot with no tracked files shows state in header
Given the session contains a FileSnapshot message with no tracked files
When the card is rendered
Then the card header indicates no files are tracked and no card body is rendered

### Scenario: Non-user-message cards are collapsed by default
Given the user views a session page
When the page loads
Then all non-user-message card types are displayed in collapsed state showing only minimal header information

### Scenario: Expanding a collapsed card reveals full content
Given the user is viewing a collapsed card
When the user expands it
Then full card content including the body becomes visible

### Scenario: User message cards are fully expanded by default
Given the session contains a pure user message (not a tool result)
When the page loads
Then that user message card is fully expanded by default

### Scenario: Tool-result messages display amber badge and are collapsed by default
Given the session contains a user message that is a tool result
When the card is rendered
Then the card header displays an amber 'tool result' badge and the card is collapsed by default

### Scenario: Consecutive non-user messages between user turns are hidden behind ellipsis
Given the session contains multiple consecutive non-user messages between two user messages
When the page loads
Then the non-user messages are hidden behind an ellipsis showing their count

### Scenario: Clicking ellipsis expands hidden messages
Given the user can see an ellipsis indicator hiding grouped messages
When the user clicks the ellipsis indicator
Then all previously hidden messages expand and become visible

### Scenario: System loads more messages when most are hidden
Given the user is viewing a session where most messages are hidden
When sufficient visible content drops below threshold
Then the system loads more messages automatically so that adequate visible content is available

### Scenario: Session detail page displays full metadata summary
Given the user opens a session detail page
When the page loads
Then they see the same metadata summary including title, plan indicator, agent, session ID, message and prompt count, date range, duration, and size that appears on the session card

---

## Feature: Session Viewer – Session Cards and Sorting

### Scenario: Sessions sorted by last message time with plan badges visible
Given the user views the project page
When sessions are listed
Then they appear in a single column sorted by last message time with the most recently active session at the top and plan indicators visible at a glance

### Scenario: Same-day session shows shared date with both start and end times
Given the user views a session card where start and end fall on the same day
When the card is rendered
Then the shared date appears once with both start and end times displayed

### Scenario: Session date omits year when session occurred in current year
Given the user views a session card for a session from the current year
When the card is rendered
Then dates display without a year component

### Scenario: Session date includes year when session occurred in a prior year
Given the user views a session card for a session from a prior year
When the card is rendered
Then dates display with the year included

### Scenario: All times display in 24-hour format
Given the user views any session card
When times are displayed
Then they appear in 24-hour format without AM/PM indicators

### Scenario: Message and prompt counts display in combined format
Given the user views a session card
When the counts are rendered
Then message count and prompt count are displayed together in the format 'XX msgs (YY prompts)'

### Scenario: Clicking plan badge on session card navigates to plan entry without opening session
Given the user can see a plan badge on a session card
When the user clicks only the plan badge
Then they navigate to the plan entry without also navigating to the session page

### Scenario: Clicking elsewhere on session card navigates to session page
Given the user can see a session card with a plan badge
When the user clicks elsewhere on the card (not the plan badge)
Then they navigate to the session page

---

## Feature: Session Viewer – Plan Rendering

### Scenario: Write or Edit tool interaction on plan file shows rendered markdown
Given the session contains a Write or Edit tool interaction targeting a plan file
When the user views the entry
Then rendered markdown content is shown with a plan name header instead of raw JSON

### Scenario: Read tool interaction on plan file shows rendered markdown
Given the session contains a Read tool interaction targeting a plan file
When the user views the entry
Then rendered markdown content is shown instead of raw JSON

### Scenario: Plan-related entries are marked with purple badge
Given the user is scrolling through session entries
When they encounter entries that reference plan files
Then those entries are visually marked with a purple badge

### Scenario: Clicking plan badge on entry card expands entry to show plan content
Given the user can see a purple plan badge on an entry card
When the user clicks the badge
Then the entry expands to reveal the message content including plan-related blocks

### Scenario: Navigating to URL hash targeting plan entry extracts and shows it
Given the user navigates to a URL hash targeting an entry containing a plan block
When the page loads
Then the highlighted entry is extracted from the grouping system, rendered as a standalone card between collapsed groups, and its plan block content is visually expanded and visible

### Scenario: Clicking plan badge on session page navigates to associated plan
Given the user is on the session detail page and can see a plan badge
When the user clicks the plan badge
Then the browser navigates to the associated plan entry

### Scenario: Markdown tables in plan content render as formatted tables
Given the session contains a plan file with a markdown table
When the entry is rendered
Then the table renders as a formatted table rather than raw pipe-delimited text

### Scenario: Only Claude Code sessions appear on the project sessions page
Given the user navigates to the project sessions page
When the page loads
Then only Claude Code sessions are shown and the page loads faster due to exclusion of non-Claude Code agent sessions

---

## Feature: Session Viewer – Thinking Blocks and IDE Tags

### Scenario: Thinking blocks show secondary tag and collapsed preview
Given the user views a session with thinking blocks
When the thinking block card is rendered
Then the thinking block is marked with a secondary tag and the collapsed state shows a preview of the thinking content

### Scenario: IDE tag badges appear for each ide_ tag in a user message
Given the user views a session message containing <ide_*> tags
When the message is rendered
Then a tag indicator is shown for each such tag

### Scenario: Clicking an IDE tag badge toggles its expanded state
Given the user can see an IDE context tag badge
When the user clicks it
Then the tag expands to reveal its full content or collapses if already expanded

### Scenario: Long file paths in IDE tag are truncated from the left
Given the user views a message containing an IDE tag with a long file path
When the path is rendered
Then the path is shown truncated from the left with ellipsis so the filename remains visible

### Scenario: CWD prefix in paths is replaced with $CWD
Given the user views a message containing a path that starts with the current working directory
When the path is rendered
Then the CWD portion is replaced with $CWD for brevity

### Scenario: Tool result header shows tool name and relevant path
Given the user views a file read or write tool result
When the header is rendered
Then the header shows the tool name and the file path truncated with leading ellipsis if too long

### Scenario: Message timestamp appears at far right of header row
Given the user views any message
When the header is rendered
Then the timestamp appears at the far right of the header row showing date, hours, minutes, and seconds and remains visible in both collapsed and expanded states

### Scenario: Bash tool call entry card shows command in header badge
Given the user views a Bash tool call entry card
When the header is rendered
Then the header shows an amber badge with the command truncated at the trailing end if too long

### Scenario: Tool result entry header shows originating tool name via lookup
Given the user views a tool result entry card
When the header is rendered
Then the header shows the originating tool name and contextual detail resolved via tool-use-id lookup

### Scenario: Expanding a tool result automatically expands inner file contents
Given the user is viewing a tool result entry
When the user expands it
Then the tool result blocks within are already expanded by default and their headers retain file names and all other details

### Scenario: Tool block headers are identical in collapsed and expanded states
Given the user is viewing a tool call node block
When the user collapses or expands it
Then the header looks identical in both states with no content appearing or disappearing

---

## Feature: Session Viewer – Three-Layer Display Pipeline

### Scenario: Important blocks are immediately visible without interaction
Given the user opens a session view
When the page loads
Then important blocks like prompts, plans, and answers are immediately visible without any interaction required

### Scenario: Progress blocks appear as a single collapsed group
Given the session contains a series of consecutive progress blocks
When the page loads
Then they appear as a single collapsed group rather than many individual entries
And the user can expand the group to reveal all grouped progress blocks

### Scenario: Tool call unit shows call, hooks, and result together
Given the user encounters a tool call in a session
When the user expands the tool call unit
Then the associated hooks and tool result are shown together

### Scenario: All blocks in a session are reachable by the user
Given the session contains collapsed or grouped blocks
When the user wants to view any block
Then they can expand the relevant collapsed block or group and the full content becomes visible

### Scenario: Expand All expands all collapsed blocks and groups simultaneously
Given the user is viewing a session with multiple collapsed blocks
When the user clicks 'Expand All'
Then all collapsed blocks and groups expand simultaneously

### Scenario: All non-primary-interest cards between two primary cards form one collapsed group
Given the session contains many consecutive non-primary-interest cards between two primary-interest cards
When the page loads
Then all non-primary-interest cards appear as a single collapsed group rather than multiple groups

### Scenario: User can inspect and adjust filter and classification controls
Given the user accesses the filter and classification controls
When they view the controls
Then they can inspect and adjust which cards are primary interest, what the collapsed/expanded defaults are, and which cards are topically grouped

### Scenario: Single-card sequence appears standalone without group wrapper
Given the session contains a sequence that would form a topical group with only one card
When the page loads
Then the card appears standalone without a group wrapper

### Scenario: Collapsed group with timing data shows duration on right side
Given the user views a collapsed group that has duration data
When the group header is rendered
Then the duration is shown on the right side of the group header

### Scenario: Expanding collapsed group containing single topical group expands both
Given a collapsed group contains exactly one topical group as its sole child
When the user expands the collapsed group
Then both the collapsed group and its single topical group child expand simultaneously

### Scenario: Groups containing only queue operations auto-expand on initial render
Given the session contains a group consisting entirely of queue operation items
When the page first renders
Then the group auto-expands rather than remaining collapsed

### Scenario: Session-level most common model is shown and per-card model omitted when matching
Given a session where most cards share the same model
When the page loads
Then the common model appears once at the top of the session and is absent from individual cards that use it

### Scenario: Card shows its model when it differs from the session-level model
Given the user views a card that used a different model than the session's most common
When the card is rendered
Then that card displays its model explicitly

### Scenario: User and assistant messages are visually distinct
Given the user views a conversation session
When messages are rendered
Then user messages are visually distinct from assistant messages through contrasting color schemes making it easy to tell who said what at a glance

### Scenario: All entries load automatically without requiring scroll interaction
Given the user opens a conversation view
When the page loads
Then all entries load automatically in sequence without requiring any scroll interaction

### Scenario: Filter controls allow user to change active filter setting
Given the user opens the conversation view
When the user interacts with the filter controls
Then they can change which entries are displayed

### Scenario: Filter controls reflect previously saved settings on load
Given the user has previously saved filter settings
When the conversation view is loaded
Then filter controls are already reflecting the persisted settings without requiring manual reapplication

### Scenario: Collapsing an expanded filter pill updates the conversation view
Given the user has a filter pill in expanded state
When the user collapses the filter pill
Then the conversation view updates to reflect the new filter state

### Scenario: Collapsed group header shows accurate card count
Given the user views a collapsed group
When the header is rendered
Then the left-side card count indicator shows '▸ XXX cards' with a count that matches the actual group contents

### Scenario: Tool call summary text uses N ToolName format
Given the user reads a collapsed group summary
When the summary is rendered
Then tool call counts are displayed in 'N ToolName' format (e.g. '3 Subagent', '8 Bash') and the term 'Agent' is replaced with 'Subagent'

### Scenario: Subagent tool-call card shows type and description in title bar
Given the user views a subagent tool-call card
When the header is rendered
Then the subagent type and description are visible in the title bar without expanding the card

### Scenario: Expanded subagent card shows Prompt heading, worked-for duration, and result without repeating description
Given the user expands a subagent tool-call card
When the card body is visible
Then the body shows a 'Prompt' heading above the prompt content, a 'Worked for XXs' duration label between sections, and the result content without redundant repetition of the description

### Scenario: Subagent tool-result card content renders as markdown
Given the user views a subagent tool-result card
When the content is rendered
Then the result content renders as formatted markdown

---

## Feature: Session Viewer – SQLite Caching for Performance

### Scenario: Project list loads quickly on first and repeat loads
Given project discovery results are cached in SQLite
When the user loads the project list for the first time
Then the list loads quickly without multi-second delay
And when the user loads the project list again within 30 seconds it loads near-instantly from cache

### Scenario: Session list loads quickly via indexed cwd query
Given session entries are indexed by cwd in SQLite
When the user loads sessions for a specific project path
Then sessions load quickly via the SQLite cwd index query

### Scenario: Paginated session entries load quickly via SQL pagination
Given sessions are stored with paginated entries in SQLite
When the user paginates through session entries
Then entries load quickly via SQL pagination

---

## Feature: Vibe Personality – Impatience Metric

### Scenario: User reviews the impatience metric draft plan
Given the impatience metric specification has been drafted in metrics/impatience.md
When the user reviews the draft plan
Then they can provide feedback on trait definitions and measurement methods before implementation proceeds

---

## Feature: Vibe Personality – Tracking and Workflow

### Scenario: Tracking emoji updates when work advances to a new stage
Given the tracking file exists at intent/vibe-personality/TRACKING.md
When the user instructs which metric to plan or implement
Then the tracking file emoji is updated to reflect the new stage and the corresponding metrics/ file is created or updated accordingly

### Scenario: Tracking file is created with raw candidates as separate entries
Given the user has specified tracking granularity and file location
When the tracking file is created
Then it lists each raw candidate from vibe-personality.md as a separate trackable entry at intent/vibe-personality/TRACKING.md

### Scenario: Metric definitions are visible inline in TRACKING.md
Given the user views TRACKING.md
When they scan the tracking table
Then metric definitions are visible inline in the tracking table so the user can understand what each metric measures at a glance without opening a separate file

### Scenario: Sync link presents missing metrics for human review before adding
Given the user has added a new bullet to vibe-personality.md
When the user clicks the 🔄 Sync link at the top of TRACKING.md
Then Claude diffs vibe-personality.md against TRACKING.md and presents missing metrics for the user to confirm before they are added