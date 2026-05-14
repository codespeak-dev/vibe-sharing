# Vibe-Sharing BDD Scenarios

## Feature: GitHub Repository Setup

### Scenario: Create and push repository to GitHub organisation
Given the user has the GitHub CLI installed and authenticated
When the user runs gh CLI commands to create a new repository named 'vibe-sharing' under the 'codespeak-dev' organisation and pushes the local directory
Then the repository appears under codespeak-dev/vibe-sharing on GitHub

---

## Feature: Plan Validation and Gap Analysis

### Scenario: Validate completeness of a session export plan document
Given the user has a plan file at a known path describing a vibe-share session export implementation
When the user provides the plan file path and asks whether it covers all necessary concerns
Then a structured gap analysis is returned identifying regressions, missing features, unjustified design assumptions, and credibility gaps in privacy claims

---

## Feature: CLI Tool — Core Archive and Upload Flow

### Scenario: Run tool in a git-managed project directory
Given the user is in a project directory under git version control
When the user runs the CLI tool
Then the tool detects git status, collects the right files without manual specification, and presents them for review

### Scenario: Confirm file list and upload automatically
Given the user has reviewed the file list presented by the CLI tool
When the user confirms the file list
Then the tool packages the confirmed files and uploads the data automatically, reporting progress and the final result

### Scenario: Handle project with a non-Claude-Code AI agent
Given the user has a project where the AI sessions were not created by Claude Code
When the tool runs and does not find Claude Code sessions
Then the tool asks which agent was used and locates that agent's session files

### Scenario: Suggest candidate session directories when layout is unknown
Given the tool cannot determine the agent session directory layout for the user's project
When the tool scans for candidate directories
Then it suggests relevant directories based on file path searches rather than requiring the user to navigate blindly

### Scenario: Apply default exclusions in a non-git directory
Given the user runs the CLI tool in a directory that is not under git version control
When the tool detects the non-git context
Then it applies default exclusions for common noise directories such as .venv, node_modules, and .env.local, and allows the user to adjust the exclusion list before packaging

### Scenario: Fall back to local zip when backend is unavailable
Given the user's backend is unavailable or not configured
When the user runs the CLI tool and the backend cannot be reached
Then the tool falls back to producing a local zip file the user can handle manually

### Scenario: Locate Codex or Gemini session files automatically
Given the user has used Codex, Gemini, or another supported file-system-based agent
When the tool runs
Then it locates that agent's session files automatically without requiring manual input

### Scenario: Offer file system browser for unsupported agents
Given the user has used an agent whose session storage format is not natively supported
When no supported agent session is found
Then the tool offers a file system browser to locate session files rather than failing or asking the user to type a path

### Scenario: Display privacy notice and require explicit consent before sharing
Given the user has launched the CLI tool
When the tool is about to package or upload any files
Then a clear privacy notice is prominently displayed explaining what will be shared and why, and the tool requires explicit user consent before proceeding

### Scenario: Run the tool on Windows, macOS, or Linux without platform-specific setup
Given the user is on any of Windows, macOS, or Linux
When the user runs the CLI tool
Then it executes without requiring platform-specific setup or installation steps

---

## Feature: Claude Code Plugin — Archive Creation

### Scenario: Install the plugin into Claude Code
Given the user has the vibe-share plugin files available
When the user installs the plugin into their Claude Code environment
Then the plugin becomes available for use in their projects

### Scenario: Invoke plugin to package sessions and project context
Given the user is in a project directory and the plugin is installed
When the user invokes the plugin
Then it locates relevant Claude Code session files and packages them with project context into a zip archive

### Scenario: See a reassuring privacy message at the start of archive creation
Given the user has started archive creation via the plugin
When the archive creation process begins
Then a clear, warm message appears explaining what will happen, that secrets are protected with a '(best effort)' qualifier, and that the user can review the contents afterward

### Scenario: Review zip contents after archive creation
Given the user has completed archive creation
When the archive creation process finishes
Then the user can easily inspect everything included in the zip

### Scenario: Confirm or decline archive creation via interactive prompt
Given the user has reached the consent step of archive creation
When the plugin presents the consent step
Then an interactive question tool prompts the user to explicitly confirm or decline before proceeding

### Scenario: Invoke /vibe-sharing:vibe-share slash command without error
Given the plugin is installed and the user is in a project directory
When the user invokes the /vibe-sharing:vibe-share slash command
Then the command locates the installed plugin script and runs the --scan mode without error

### Scenario: Execute vibe-share command via claude --plugin-dir flag
Given the user is in a project directory with the plugin present
When the user runs 'claude --plugin-dir . "/vibe-share"'
Then Claude Code opens and executes the vibe-share command rather than opening an idle session with no command invoked

### Scenario: Include project file tree in the archive
Given the user runs vibe-share on their project
When the archive is created
Then it contains a text file with the recursive file tree of the project directory alongside Claude Code session files

### Scenario: Mask sensitive keys in session files before archiving
Given the user runs vibe-share and session files contain sensitive keys
When the archive is created
Then sensitive keys in session files are masked before archiving so that raw secret values are never included in the zip

### Scenario: Include subagent sessions in the archive
Given the user runs vibe-share on a project with subagent sessions
When the archive is created
Then subagent sessions are included in the archive alongside top-level sessions so the full conversation history is captured

### Scenario: Include all plan files mentioned in any session
Given the user runs vibe-share and sessions reference plan files
When the archive is created
Then all plan files mentioned anywhere in any session, including subagent sessions, are copied into the archive

### Scenario: Include debug session files in the archive
Given the user runs vibe-share
When the archive is created
Then debug session files from ~/.claude/debug/ that are referenced in session transcripts are included in the archive output

### Scenario: Archive contains full historical session depth
Given the user runs vibe-share and other projects on the same system have comparable session histories
When the archive is created
Then it contains the full set of historical sessions matching the depth of history found in comparable projects, not a truncated or partial set

### Scenario: Run scan mode to report project counts
Given the user runs vibe-share in scan mode
When scan mode executes
Then the system reports counts of session transcripts, plan files, and debug files present in the project

### Scenario: Run build mode to package all referenced files
Given the user runs vibe-share in build mode
When build mode executes
Then the system collects all referenced sessions, plans, and debug files and packages them into a zip archive with a build report including session count, plan count, and debug count

### Scenario: Run review mode to preview packaged contents
Given the user has a zip archive created by vibe-share
When the user runs vibe-share in review mode
Then the system previews the contents of the packaged zip archive

### Scenario: Copy REQUIREMENTS.md plan file to the intent/ directory
Given the user has a REQUIREMENTS.md plan file
When the user copies it to the intent/ directory
Then the requirements document is stored at that organised project documentation location

---

## Feature: Session Log Extraction

### Scenario: Run extraction script to regenerate combined and per-session files
Given the user has a saved session log extraction script
When the user runs the extraction script
Then intent/msg-and-answers.md and the per-session files in intent/sessions/ are regenerated with current session log content, all entries in chronological order separated by ========== dividers

---

## Feature: Console UI Gratitude Animation

### Scenario: Display gratitude frames while scrolling through menu options
Given the user is navigating a checkbox or select prompt
When the user scrolls through menu options using arrow keys, space, or numbers
Then gratitude-themed pseudographic frames cycle or advance in the bottom-left corner of the screen with each keypress

### Scenario: Hide gratitude animation on Enter confirmation
Given a gratitude animation is displayed during a prompt
When the user confirms a selection with Enter
Then the gratitude animation disappears and the normal completion summary is shown

---

## Feature: Backend Infrastructure — AWS CDK

### Scenario: Deploy and manage backend from the command line
Given the user has AWS credentials configured and CDK bootstrapped
When the user runs CDK CLI commands to deploy, configure, and manage the backend
Then the backend is provisioned and configured without touching the AWS console

### Scenario: Upload files up to 5GB via presigned URL flow
Given the backend is deployed and the presigned URL endpoint is reachable
When the user uploads files up to 5GB through the secure presigned URL flow
Then the files are stored securely in S3

### Scenario: Submit optional reporter metadata with a presign request
Given the user is uploading a file via the CLI
When the user submits optional metadata including email, name, and repo URL as part of the presign request
Then the metadata is stored alongside the upload record

### Scenario: Deploy and tear down backend using CDK CLI
Given the user has CDK installed and AWS credentials configured
When the user runs CDK CLI commands to deploy or destroy the stack
Then the infrastructure is provisioned or removed accordingly

### Scenario: Install CDK dependencies and initialise a CDK project from the command line
Given no prior infrastructure tooling is in place
When the user installs CDK dependencies and initialises a CDK project from the command line
Then the CDK project is ready for stack definition

### Scenario: Set up AWS credentials and bootstrap CDK
Given the user configures AWS CLI using SSO or static IAM keys
When the user bootstraps CDK
Then deployments can be run from the local machine against a real AWS environment

### Scenario: Confirm SSO credentials are sufficient for CDK deployment
Given the user has configured AWS CLI using SSO via aws configure sso
When the user asks whether SSO credentials are sufficient to proceed with CDK deployment steps
Then CDK commands work with SSO credentials and no additional setup is required

### Scenario: Bootstrap CDK from a directory without cdk.json fails with a clear error
Given the user is in the backend directory which does not contain a cdk.json file
When the user runs npx cdk bootstrap without an explicit environment argument
Then the bootstrap command fails with an environment resolution error explaining that a cdk.json file or explicit environment argument is required

### Scenario: Copy plan file to the intent/app/ directory
Given the user has a project plan file
When the user copies it to the intent/app/ directory
Then the plan file is stored at that path for ongoing reference

### Scenario: Read backend/README.md to understand setup and usage
Given the user has the backend README available
When the user reads backend/README.md
Then they find clear instructions for setting up, configuring, and using the backend service

### Scenario: Set VIBE_SHARING_API_URL to test against a custom backend
Given the user has a deployed API Gateway endpoint URL
When the user sets VIBE_SHARING_API_URL to that URL and runs the CLI tool
Then the CLI connects to the specified backend for testing before a default production URL is committed to config

---

## Feature: Backend Security and Observability

### Scenario: Request a security review of the back-end
Given the backend is deployed to AWS
When the user requests a security review of the back-end
Then a report of identified security weaknesses is returned along with an explanation of how AWS resource isolation is structured

### Scenario: Provide per-issue decisions before any remediation is performed
Given the security review has identified multiple issues
When the user reviews each security issue
Then the system proceeds with remediation only for issues the user chose to address, deferring or skipping the rest

### Scenario: Enable PITR for DynamoDB and skip error message remediation
Given security issues have been identified including missing DynamoDB PITR and verbose error messages
When the user enables PITR and skips the generic error message remediation
Then PITR is scheduled for implementation and error message changes are deferred

### Scenario: Add Content-Type condition to presigned URLs
Given presigned URLs do not currently enforce content type
When the user adds a Content-Type condition to presigned URLs
Then uploads are restricted to the declared content type and arbitrary content cannot be uploaded under a misrepresented type

### Scenario: Request cost breakdown for WAF and CloudFront before any implementation
Given WAF and CloudFront options are under consideration
When the user requests a cost breakdown
Then pricing information is presented before any implementation decision is made

### Scenario: Enable CloudWatch alarms with SNS notifications
Given the backend is deployed without monitoring
When the user enables CloudWatch alarms with SNS notifications
Then monitoring and alerting is active for abuse and error conditions

### Scenario: Review and decide to skip WAF and CloudFront
Given cost estimates for WAF and CloudFront have been presented
When the user reviews the estimates and decides to skip both
Then no WAF or CloudFront protection is added and the decision is recorded

### Scenario: Receive CloudWatch alarm notification emails
Given CloudWatch alarms are configured with an SNS email subscription to alarms@codespeak.dev
When a CloudWatch alarm fires
Then the operations team receives an alert email at alarms@codespeak.dev in real time

### Scenario: Update alarms email address via a single config file entry
Given the alarm email address is defined in a central configuration file
When the user updates the email address in that config file
Then the change applies throughout the stack without searching for hardcoded strings

### Scenario: Receive a Slack message when a CloudWatch alarm fires
Given a Slack webhook Lambda is subscribed to the alarms SNS topic
When a CloudWatch alarm fires
Then the team receives a Slack message in the configured channel without needing to monitor email

### Scenario: Store Slack webhook URL in SSM Parameter Store
Given the Slack webhook Lambda retrieves its URL from SSM at runtime
When the user stores the Slack webhook URL value in SSM Parameter Store
Then the Slack Lambda can retrieve and use it at runtime to post alarm notifications to the configured Slack channel

### Scenario: Read the README to know the SSM parameter is required before deploying
Given the backend README documents the SSM parameter requirement
When the user reads the README before deploying
Then they learn they must create the SSM SecureString parameter /vibe-share/slack-webhook-url containing the Slack webhook URL

### Scenario: Review all uncommitted changes for correctness
Given security remediations have been implemented but not yet committed
When the user requests review of all uncommitted changes
Then a summary is returned of which security concerns are addressed, what gaps remain, and any mistakes found in the implementation

### Scenario: Understand what API Gateway CORS applies to in this architecture
Given the backend is consumed exclusively by CLI clients, not browsers
When the user asks for an explanation of what API Gateway CORS applies to in this architecture
Then the user understands that CORS is a browser security mechanism irrelevant to CLI clients that never run in a browser context

### Scenario: Rotate Slack webhook URL and have Lambda pick it up within 5 minutes
Given the Slack webhook Lambda caches the SSM URL with a 5-minute TTL
When the user rotates the Slack webhook URL in SSM Parameter Store
Then the Lambda picks up the new URL within 5 minutes without requiring a redeploy

### Scenario: Receive OK recovery notification when a CloudWatch alarm clears
Given CloudWatch alarms are configured with both alarm and OK actions
When the user resolves an infrastructure incident that triggered a CloudWatch alarm
Then the team receives an OK recovery notification confirming the alarm has cleared

### Scenario: Lambda throws on Slack delivery failure enabling SNS retry
Given Slack experiences an outage when a CloudWatch alarm fires
When the Lambda attempts to post to Slack and receives a failure response
Then the Lambda throws an error so SNS can retry delivery rather than recording silent success

### Scenario: Enter project directory and have AWS_PROFILE set automatically via direnv
Given an .envrc file at the project root sets AWS_PROFILE to 'default' and direnv is installed
When the user enters the project directory
Then AWS_PROFILE is automatically set to 'default' without manual sourcing or flags
And when the user leaves the project directory, AWS_PROFILE is unset so other projects are not affected

### Scenario: Receive Slack notification when a presign request is submitted
Given the presign Lambda publishes to the upload events SNS topic
When the user submits a presign request via the CLI
Then the team receives a Slack notification that a new upload has been requested including filename, size, IP, and user info

### Scenario: Receive Slack notification when an upload is successfully confirmed
Given the confirm Lambda publishes to the upload events SNS topic on success
When the user completes a file upload and the confirm endpoint validates it successfully
Then the team receives a Slack notification confirming the upload occurred including filename, size, and share URL

### Scenario: Receive Slack notification when an upload fails at confirmation
Given the confirm Lambda publishes to the upload events SNS topic on failure
When the user attempts an upload that fails and the confirm endpoint detects the file missing from S3
Then the team receives a Slack notification indicating the upload failed

---

## Feature: CDK Deployment Fixes

### Scenario: Consider whether alarm email should be stored in SSM or config
Given alarm email is non-sensitive configuration and the Slack webhook is a sensitive credential
When the user considers whether alarm email should be stored in SSM or in a config file
Then email is classified as non-sensitive and remains in the config file while the Slack webhook remains in SSM as a sensitive value

---

## Feature: CLI Error Observability

### Scenario: Developer notified automatically when CLI fails
Given the CLI automatically sends error telemetry to the backend on failure
When a user encounters a CLI failure
Then the developer is automatically notified via telemetry without waiting for the user to report the issue

### Scenario: Trace full request journey using correlation ID
Given the CLI generates a correlation ID that flows through each step and corresponding backend calls
When the user reports an issue
Then the developer uses the correlation ID from logs to trace the full request journey across CLI and backend

### Scenario: Reconstruct context from local diagnostic log
Given the CLI writes a local diagnostic log file on every run
When a developer investigates a client-side failure
Then the developer reconstructs context from the local diagnostic log file the user shares

---

## Feature: CLI Onboarding and UX Improvements

### Scenario: Pre-populate email and username from git config
Given the user has git config with email and username set
When the user runs the CLI app
Then the app uses those git config values without prompting the user for them

### Scenario: Prompt for email and username when git config is absent
Given the user has no git config values for email or username
When the user runs the CLI app
Then the app prompts the user to enter email and username manually

### Scenario: Display step-aware error message on upload failure
Given the user has completed archive creation, consent, and repo URL steps
When the upload fails at the confirm step
Then the CLI displays a step-aware error message naming which step failed along with suggestions to use the --output and --verbose flags

### Scenario: Show full error cause chain with --verbose flag
Given a previous upload attempt failed at the confirm step
When the user re-runs with the --verbose flag
Then the CLI displays the full cause chain including HTTP status code and backend response body

### Scenario: Enable auto-approve for all future CDK deployments
Given the user runs cdk deploy with the auto-approve flag once
When future deployments are run
Then they proceed without requiring manual confirmation input

### Scenario: Run cdk-deploy script with auto-approve behaviour automatically
Given a cdk-deploy script exists in the scripts/ directory
When the user runs cdk-deploy from the scripts directory
Then CDK deployment executes with auto-approve behaviour without the user needing to specify any flags

---

## Feature: Sharing Consent Default

### Scenario: Sharing consent prompt defaults to yes
Given the user launches the CLI app and encounters the data sharing consent prompt
When the prompt is displayed
Then the default selection is 'Y' so pressing Enter without input accepts sharing

---

## Feature: Share URL Generation

### Scenario: Receive a working presigned S3 download URL after upload
Given the confirm endpoint is updated to return a presigned S3 GET URL with 7-day expiry
When the user completes an upload
Then a presigned S3 GET URL is displayed that can be opened in a browser to access the uploaded content

---

## Feature: Upload Record Status and Maintenance

### Scenario: View all upload records in a formatted table
Given the status script is accessible and the DynamoDB table contains upload records
When the user runs status.sh
Then a formatted table is printed showing all upload records with upload ID, status, filename, size, creation timestamp, confirmation timestamp (or dash if absent), repository URL, submitter name, and email

### Scenario: Run status.sh directly without specifying a path
Given direnv is installed and the .envrc adds the scripts directory to PATH
When the user navigates to the project directory and runs status.sh directly as a command
Then the command executes without requiring the user to specify the full path

### Scenario: Display upload records without fetching lambda logs by default
Given the status script is available
When the user runs status.sh without the --logs flag
Then upload record states are displayed without fetching lambda logs

### Scenario: Display upload records along with lambda logs when requested
Given the status script is available
When the user runs status.sh with the --logs flag
Then upload record states are displayed along with lambda logs

### Scenario: Clear all DynamoDB records and S3 objects via confirmation phrase
Given the clear-uploads script is available and the table contains records
When the user runs the clear-uploads script, reviews the count of items to be deleted, and types 'delete all' at the confirmation prompt
Then all DynamoDB records and S3 objects are deleted, leaving both stores empty

---

## Feature: Zero-Configuration Public Endpoint

### Scenario: Run npx and upload without any configuration
Given the CLI defaults to https://vibe-share.codespeak.dev as the server URL
When the user runs 'npx codespeak-vibe-share' without providing any server URL or environment variable
Then the tool launches and is ready to upload without any configuration step

### Scenario: Upload succeeds without user providing a server URL
Given the CLI has a default server URL configured
When the user uploads files
Then the upload succeeds without the user having provided a server URL

### Scenario: Add ACM DNS validation CNAME record and certificate validates
Given an ACM certificate for vibe-share.codespeak.dev is pending DNS validation
When the user adds the ACM DNS validation CNAME record at their registrar
Then the certificate validates and vibe-share.codespeak.dev resolves to the API Gateway endpoint

### Scenario: Receive DNS record instructions referencing the correct custom domain
Given the user needs to configure DNS for the custom domain
When the user requests DNS record instructions
Then they receive instructions referencing vibe-share.codespeak.dev with the correct names, types, and values to add at their registrar

### Scenario: Access the application from a third-party machine via public domain
Given the custom domain vibe-share.codespeak.dev is configured and the stack is deployed
When the user accesses the application from a third-party machine using that domain
Then the application responds successfully

### Scenario: Verify public accessibility from an external machine
Given the backend is deployed and the custom domain is configured
When the user runs curl https://vibe-share.codespeak.dev/health from an external machine that is not the deployment environment
Then a successful response is returned

---

## Feature: Git-Managed Project Packaging

### Scenario: Package a git project with full context including diffs and bundle
Given the user runs the CLI tool against a git-managed project directory
When the tool executes
Then it produces a structured package containing git status, two separate git diff files (unstaged and versus HEAD), a file listing, untracked files, a git bundle, and any referenced plan or debug session files including tool-results/ and subagents/ directories

### Scenario: Browser file system option for sessions functions correctly
Given the user is in the session setup flow
When the user selects the browser file system option for sessions
Then the feature functions as expected without errors or failures

### Scenario: Select individual untracked files to include during session setup
Given the user is prompted during session setup
When the user selects individual untracked files to share
Then those files are included in the session context

### Scenario: Unzip archive and find sessions/.claude/ replicating local .claude structure
Given the user has downloaded and extracted the archive
When the user opens the archive
Then they find sessions/.claude/ replicating the local .claude folder structure with project files, plans, and debug sessions in their expected locations

### Scenario: Identify archive by repository or folder name without opening it
Given the user has a downloads or output folder containing archives
When the user views the folder
Then they can identify each archive by its repository or folder name without needing to open it

---

## Feature: Web UI — File Browsing and Authentication

### Scenario: Authenticate before accessing uploaded files
Given the web UI is deployed and Cognito authentication is configured
When the user visits the web UI
Then they are prompted to authenticate before accessing files

### Scenario: Gain access to uploaded files after successful authentication
Given the user is on the web UI login screen
When the user authenticates successfully
Then they gain access to the list of uploaded files and can download them

### Scenario: Add a new team member to the Cognito user pool
Given the user has admin access to the Cognito user pool
When the user adds a new team member
Then that member gains access to the file browsing and download interface

### Scenario: Remove a team member from the Cognito user pool
Given a team member currently has access via the Cognito user pool
When the user removes that team member from the pool
Then that member loses access to files

### Scenario: Deploy CDK stack and receive live infrastructure outputs
Given the CDK stack code is ready to deploy
When the user deploys the CDK stack
Then the stack completes successfully and outputs live infrastructure URLs and identifiers

### Scenario: Configure web UI with correct OAuth settings from stack outputs
Given stack outputs include CognitoClientId and WebUiUrl
When the user copies those values from stack outputs into config.js
Then the web UI becomes functional with correct OAuth configuration

### Scenario: Update Cognito callback URLs to avoid login flow errors
Given the CloudFront domain is available as the web UI URL
When the user updates Cognito client callback URLs to the CloudFront domain
Then the OAuth login flow completes without callback URL mismatch errors

### Scenario: Create a test user and verify they can authenticate
Given the user has the user creation script available
When the user runs the user creation script with a username and password
Then a new user is created in the Cognito user pool and can authenticate via OAuth login at the CloudFront-hosted web UI

### Scenario: Self-register as a codespeak.dev staff member
Given the Cognito user pool allows self-registration for @codespeak.dev email addresses
When a user with a @codespeak.dev email address registers via the Cognito login page
Then they are registered without requiring admin intervention

### Scenario: Receive a temporary password and set a permanent password on first login
Given a new user account has been created in Cognito
When the user first logs in
Then they receive a temporary password via email and are required to set a permanent password

### Scenario: View authenticated user's email address in the UI
Given the user is authenticated in the web UI
When the user views the UI
Then their email address is displayed

### Scenario: View shortened and linked repository URL in the UI
Given the user's repository remote is configured with any common GitHub URL format
When the user views the UI
Then they see a correctly shortened 'user/repo' label rendered as a hyperlink linking to the correct GitHub repository page

### Scenario: Access the application via the custom domain admin.vibe-share.codespeak.dev
Given the custom domain and ACM certificate are configured
When the user navigates to admin.vibe-share.codespeak.dev
Then the application loads correctly

### Scenario: Request ACM certificate in us-east-1 and add DNS validation record
Given the web UI CloudFront distribution requires an ACM certificate in us-east-1
When the user runs AWS CLI commands to request and describe the ACM certificate in us-east-1 and adds the CNAME DNS validation record at their registrar when prompted
Then the certificate validates and the CDK stack update can proceed

---

## Feature: Internal Email Management

### Scenario: View main table with internal emails hidden by default
Given the main user table has internal emails configured
When the user views the main table
Then internal emails are hidden by default

### Scenario: Show internal emails by checking the toggle
Given internal emails are currently hidden in the main table
When the user checks the 'Show internal' checkbox
Then internal emails become visible in the table

### Scenario: Mark a user's email as internal from the main table row
Given the user is viewing the main table
When the user clicks the mark-as-internal button on a row
Then that email is flagged as internal and hidden on the next default load

### Scenario: Add an email to the internal list via the dedicated management page
Given the user has navigated to the internal emails management page
When the user adds an email to the internal list
Then the email is persisted as internal

---

## Feature: Internal Uploads Preference Persistence

### Scenario: Save and restore 'Show internal uploads' preference when enabled
Given the user is viewing the uploads page
When the user enables the 'Show internal uploads' checkbox, applies the filter, and returns on a subsequent page load
Then the checkbox remains checked and the preference is restored from localStorage

### Scenario: Save and restore 'Show internal uploads' preference when disabled
Given the user previously had 'Show internal uploads' enabled
When the user disables the checkbox and applies the filter, then returns on a subsequent page load
Then the checkbox remains unchecked and the preference is restored from localStorage

---

## Feature: Claude Code CLAUDE.md Resolution

### Scenario: Identify git repository root from a subfolder
Given the user is in a subfolder within a git repository
When the user runs Claude Code CLI from that subfolder
Then Claude Code correctly identifies the git repository root as the project root and resolves CLAUDE.md accordingly

---

## Feature: Project Root Detection for Session Lookup

### Scenario: Locate sessions correctly when running from a subfolder
Given the user is in a subfolder of a project
When the user runs the CLI tool
Then the tool correctly locates sessions created from the actual project root

### Scenario: Locate sessions correctly from a subfolder of a non-git project
Given the user is in a subfolder of a project that has no .git directory
When the user runs the CLI tool
Then the tool correctly locates sessions created from the actual project root rather than silently returning no results

---

## Feature: Slack Notifications — Internal User Distinction

### Scenario: Display :codespeak: emoji prefix for internal user uploads
Given a user uploading is classified as internal based on the InternalEmailsTable
When that user uploads a file
Then the top-level Slack thread message appears prefixed with the :codespeak: emoji, distinguishing it from external uploads

---

## Feature: Slack Notifications — Enriched Messages and Threaded Replies

### Scenario: Slack notification shows user context in top-level message
Given a user submits a repository for processing
When the Slack notification is sent
Then it shows the user's name, email, and repo URL in the top-level message

### Scenario: Stage updates posted as threaded replies
Given a user's upload is progressing through multiple stages
When each stage update is sent
Then each update is posted as a threaded reply under the original Slack message rather than appearing as a new top-level message

### Scenario: Download link appended to top-level message on completion
Given a user's upload processing completes
When the confirmation is sent
Then a download link is appended to the original top-level Slack message

### Scenario: Clicking the download link prompts authentication then starts download
Given a download link is present in the top-level Slack message
When the user clicks the link
Then they are prompted to authenticate via Cognito if not already logged in, and the download begins automatically without further interaction

### Scenario: Email alert sent when Slack notification fails
Given a file is uploaded and the Slack notification fails
When the Slack delivery error occurs
Then an email alert is sent notifying of the failed Slack operation

### Scenario: Lambda invalidates cached Slack token on error
Given the Slack webhook Lambda has cached a Slack bot token
When a Slack notification fails due to an invalid token
Then the Lambda invalidates the cached token on error, allowing recovery on the next invocation without waiting for the 5-minute cache TTL

### Scenario: Upload notifications show human-readable top-level message with JSON in thread
Given a file upload event occurs
When the Slack notification is sent
Then the top-level message is a plain-language summary and the detailed structured JSON appears in the thread reply

### Scenario: CloudWatch alarm notifications follow the same message structure
Given a CloudWatch alarm fires
When the Slack notification is sent
Then the top-level message is human-readable and the detailed JSON appears in the thread reply

### Scenario: Each upload creates its own independent Slack thread
Given multiple file uploads have occurred
When Slack notifications are sent for each upload
Then each upload appears as a separate top-level message with its own dedicated thread rather than all uploads being grouped as replies in one shared thread

---

## Feature: npm Package Publication

### Scenario: Run npx scoped package without prior installation
Given the package is published to the npm public registry under the scoped name '@codespeak/vibe-share'
When the user runs 'npx @codespeak/vibe-share' in any terminal
Then the CLI tool downloads and executes without requiring a prior install step

### Scenario: Global install retains existing bin command name
Given the scoped package is installed globally
When the user invokes the globally installed package
Then the bin command name 'codespeak-vibe-share' is available for global install invocations

### Scenario: Verify only dist/ files are included before publishing
Given the package.json 'files' field restricts published files to the dist/ directory
When the user runs 'npm pack --dry-run'
Then only dist/ files are listed as included in the package

### Scenario: Verify package installs and executes after publishing
Given the package has been published to npm
When the user runs 'npx codespeak-vibe-share --version'
Then the package installs and executes correctly

### Scenario: Authenticate with npm before publishing
Given the user needs to publish the package
When the user runs npm login
Then the npm CLI accepts credentials and allows publish

### Scenario: Bump version and create git commit and tag automatically
Given the user is ready to publish a new minor version
When the user runs npm version minor
Then package.json version is updated to 0.2.0 and a git commit and tag are created automatically

### Scenario: Publish package with TypeScript compiled automatically
Given the package has a prepublishOnly script that runs tsc
When the user runs npm publish
Then the prepublishOnly script compiles TypeScript and the package is published to the npm registry

---

## Feature: Email Verification and Password Recovery

### Scenario: Verify email address before account becomes active
Given a new user is registering with an email address
When the user completes the sign-up form
Then they receive a verification email and must confirm it before their account is active

### Scenario: Receive and complete a password recovery email
Given a registered user needs to reset their password
When the user requests a password recovery email
Then they receive the email and can complete the password reset flow

---

## Feature: Archive Size Estimation

# TODO: needs disambiguation
### Scenario: Archive size estimate includes all content
Given the archive size estimation logic runs for a project
When the size estimation completes
Then the total size estimate reflects both session data and project files without dramatic underestimation

---

## Feature: Lambda Node.js Runtime Upgrade

### Scenario: Upgrade all Lambda functions to Node.js 22.x
Given the user has received an AWS Health notification about Node.js 20.x end-of-support
When the user confirms Node.js 22.x as the target version and the runtime replacement is applied across all 4 Lambda definitions in the CDK stack
Then the user can proceed with deployment preview and rollout with all Lambdas running Node.js 22.x

---

## Feature: Cursor Session Bundling

### Scenario: Bundle Cursor subagent sessions alongside other agent sessions
Given the user has Cursor subagent sessions associated with a project
When the user selects the store.db copy approach for bundling
Then Cursor session data is bundled as intact SQLite files in the project archive

### Scenario: Discover plans created via Cursor IDE UI using registry-based lookup
Given a user has plans created through the Cursor IDE UI that are not referenced in session blob data
When the user bundles a Cursor project
Then those plans are discovered via the composer.planRegistry in state.vscdb, linked to sessions through composerId matching, their .md files are included in the archive, and the relevant state.vscdb registry data is preserved in the archive

### Scenario: Locate additional Cursor projects with agent transcripts for test coverage
Given the user has an extensive history of Cursor agent use across multiple projects
When project discovery scans the user's Cursor workspace storage
Then several projects are identified containing agent transcripts with plans referenced directly from sessions, providing real test cases for the bundling workflow

---

## Feature: CLI App Redesign — Project Discovery and Sharing Flow

### Scenario: View project list with all discovered projects on launch
Given the user runs the CLI from any directory
When the CLI launches
Then the Project List screen is shown listing all discovered projects with their associated agents and per-project actions

### Scenario: Greet user by first name from git config on project list
Given the user has a first name set in git config
When the user views the Project List
Then they are greeted by first name at the top of the screen

### Scenario: Select a project and view full project stats
Given the user is on the Project List screen
When the user selects Share on a project
Then they see full project stats and are asked whether to share

### Scenario: Review agent sessions, file tree, and git info before sharing
Given the user is on the Share Project screen
When the user chooses Review Before Sharing
Then they can browse agent sessions, navigate the file tree with Not Shared files marked, and view git branches and commits before deciding to share

### Scenario: Confirm consent and complete project upload
Given the user has reviewed the project and is on the consent screen
When the user proceeds to share and confirms
Then the project is zipped and uploaded

### Scenario: Press Escape to navigate back
Given the user is on any screen that has a back action
When the user presses Escape
Then they are returned to the previous screen

### Scenario: Open a session by pressing Enter on the Review screen
Given the user is on the Review screen viewing a session list
When the user presses Enter on a session
Then the session content is previewed

### Scenario: Press Esc while previewing a file to return to the Files tab
Given the user is previewing file contents on the Review screen
When the user presses Esc
Then they are returned to the Files tab of the Preview screen rather than to the Share Project screen

### Scenario: Claude session first messages display without ide tags
Given the user opens a Claude session on the Review screen
When the session content is displayed
Then first messages are shown without <ide_*> tags

### Scenario: Welcome header shown when Share Project is the first screen
Given the user opens the CLI for the first time and lands on the Share Project screen
When the screen is displayed
Then a welcome header greets them

### Scenario: Consent screen has prominent Enter confirm and secondary Esc action
Given the user has reached the consent screen
When the screen is displayed
Then Enter is the prominent confirm action and Esc is a visible but secondary action

### Scenario: Post-share screen shows Thank You box with deletion footnote and Share Another as default
Given the user has completed a share
When the post-share screen is shown
Then the Thank You box is displayed with deletion instructions as a footnote below it and Share Another is the default highlighted action

### Scenario: Navigate project list with arrow keys and open project with Enter
Given the user is on the Project List screen
When the user navigates the project list using arrow keys and presses Enter to open a project
Then the project opens

### Scenario: Press Escape from Project Share screen to reach All Projects screen
Given the user is on the Project Share screen
When the user presses Escape
Then they land on the All Projects screen

### Scenario: Sessions with empty names display correctly when they contain messages
Given a session has an empty name but contains messages
When the user opens that session
Then the session messages are displayed

### Scenario: Opening any session displays its message history
Given a session exists in the project
When the user opens the session
Then the message history is displayed

### Scenario: Project list is sorted by total session count descending
Given multiple projects are discovered
When the user views the project list
Then projects are sorted by total session count in descending order

### Scenario: Project Share screen displays worktree count and all-worktrees session count
Given a project has multiple worktrees
When the user views the Project Share screen
Then the worktree count and session count reflecting all worktrees are displayed

### Scenario: Select 'Share another project' from the Project List screen
Given the user is on the Project List screen
When the user selects 'Share another project'
Then the sharing flow is initiated for a different project

### Scenario: Worktrees of the same repository appear as a single unified project list entry
Given a project has multiple worktrees previously listed as separate entries
When the user views the project list
Then they see a single unified entry with combined session counts

### Scenario: Tab cycles focus between tabs, list, and action buttons on Review screen
Given the user is on the Review screen
When the user presses Tab
Then focus cycles from the tab bar to the content area to the action buttons and back

### Scenario: Shift+Enter opens a session without triggering action bar
Given the user has highlighted a session in the list on the Review screen
When the user presses Shift+Enter
Then the session opens without accidentally triggering Share or Back buttons

### Scenario: Project list heading reads 'Share another project:' after sharing
Given the user has shared a project
When the user returns to the project list
Then the heading reads 'Share another project:'

### Scenario: Project with hyphens in path appears in the project list
Given a project path contains hyphens that are ambiguous under lossy decode
When the user views the project list
Then the project appears in the list

### Scenario: Each git-rooted subfolder appears as a distinct project entry
Given a parent directory contains subfolders each with their own .git root and associated agent sessions
When the user opens the project list
Then each subfolder appears as a separate discoverable project entry

### Scenario: Long project list is scrollable without entries hidden
Given the project list has more entries than the visible terminal height
When the user views the project list
Then they can scroll through all entries without any being cut off or hidden

### Scenario: Down arrow from tabs zone moves focus to content list
Given the user is on the Review screen with focus in the tabs zone
When the user presses the down arrow
Then focus moves to the content list zone so the user can immediately navigate list items

### Scenario: Content list displays a visible highlight when its zone is focused
Given the user has navigated focus to the content list zone on the Review screen
When the content list zone is active
Then the list displays a visible highlight indicating it is the active focused zone

### Scenario: Reaching the top of content list moves focus to tabs zone
Given the user is navigating the content list on the Review screen
When the user navigates upward from the top of the list
Then focus moves to the top menu/tabs area

### Scenario: Reaching the bottom of content list moves focus to actions zone
Given the user is navigating the content list on the Review screen
When the user navigates downward from the bottom of the list
Then focus moves to the bottom actions area

### Scenario: Progress bar displayed during long-running operations
Given the user triggers a long-running operation
When the operation is in progress
Then a progress bar is displayed for the duration

### Scenario: Application opens with current directory project pre-selected
Given the user's current working directory is under a listed project
When the user opens the application
Then the project list opens with that project marked as '(current dir)' and pre-selected at the top of the list

### Scenario: Application opens normally when current directory is unrelated to any project
Given the user's current working directory is not under any listed project
When the user opens the application
Then the project list opens normally with no project marked as current dir

---

## Feature: Session Viewer — Project Path Display and Session Count Accuracy

### Scenario: Project path visible at top of review screen at all times
Given the user opens the review screen for a project
When the screen is displayed
Then the project path is visible at the top of the screen without any additional action required

### Scenario: Session count in tab label matches session list count
Given the user opens the review screen for a project
When the tab and session list are displayed
Then the session count shown in the tab label matches the number of sessions visible in the session list

### Scenario: Cursor sessions appear in the session list for a project
Given a project has Cursor sessions
When the user opens the review screen for that project
Then Cursor sessions appear in the session list

---

## Feature: Redesigned Minimal CLI UI

### Scenario: Collection begins with progress bar and no-upload reassurance
Given the user launches the tool
When collection begins
Then a progress bar is displayed and a message informs the user that no information is sent to CodeSpeak during collection

### Scenario: Select a project from the discovered projects table
Given the user is viewing the project list table with columns for project path, session count, and agent names
When the user navigates with arrow keys and presses Enter on a project
Then the project summary screen is shown

### Scenario: Share a project and return to project list on completion
Given the user is on the project summary screen
When the user presses Enter on Share, consents on the consent screen, and the share completes
Then the user is returned to the project list

### Scenario: Create a zip and browse its contents
Given the user is on the project summary screen
When the user navigates to Make a zip and presses Enter
Then the zip is created and a directory browser opens showing the zip contents; the user can browse with up/down keys and press Esc or Back to return to the project summary

### Scenario: Share from the zip contents screen
Given the user is on the zip contents browser screen
When the user navigates to Share and presses Enter
Then the share flow runs

### Scenario: Exit from the zip contents screen
Given the user is on the zip contents browser screen
When the user navigates to Exit and presses Enter
Then the application closes

---

## Feature: Session Viewer — Next.js Application

### Scenario: View all discovered sessions grouped by project
Given the Next.js session viewer application is running
When the user opens the session viewer
Then they see all discovered sessions listed and grouped by project

### Scenario: Session card shows AI title or fallback preview
Given the user is viewing session summaries in the project list
When a session contains an 'ai-title' entry with an aiTitle field
Then the aiTitle value is shown as the preview text
And when a session has no ai-title, the preview shows the first lines of user messages plus user message count and agent summary content

### Scenario: Open a session and see the complete ordered sequence of JSON objects
Given the user is on the session viewer
When the user opens a session
Then they see the complete ordered sequence of every JSON object in that session

### Scenario: View formatted and highlighted JSON with long strings collapsed
Given the user is viewing a JSON object in raw mode
When the JSON is displayed
Then it is formatted and highlighted with long strings collapsed to ellipsis

### Scenario: Click a long string to reveal its full content
Given the user is viewing a session with a long string collapsed to ellipsis in the JSON view
When the user clicks the long string
Then the full unescaped multiline value is shown

### Scenario: View rendered message type and contents for recognised types
Given the user is viewing a JSON object
When the message type is recognised
Then the user sees the message type and rendered contents in rendered mode

### Scenario: Rendered view not available for unrecognised message types
Given the user is viewing a JSON object with an unrecognised message type
When the user attempts to access rendered mode
Then the rendered view option is not available for that object

### Scenario: Large sessions load incrementally via paginated API
Given the user opens a large session
When entries are loaded
Then they arrive incrementally in pages via the API rather than all at once

### Scenario: Project cards show only the session count pill, no agent badge
Given the user is viewing the project list
When each project card is displayed
Then only the session count pill is shown in the top-right area with no agent badge present

---

## Feature: Session Viewer — Session Cards with Metadata

### Scenario: Sessions sorted by most recent activity on project page
Given the user views the project page
When sessions are displayed
Then they are listed in a single column sorted with the most recently active session at the top

### Scenario: Session card shows plan badge when session contains a plan
Given the user views a session card
When the session contains references to plan files
Then a badge is shown indicating the session contains a plan

### Scenario: Session card shows date and time range correctly
Given the user views a session card where start and end are on the same date
When the dates are displayed
Then the shared date appears once with both start and end times in 24-hour format
And when a session card has start and end on different dates, each full datetime is shown; when in the current year the date is shown without a year; when in a past or future year the year is included; and duration is shown when start and end times differ

### Scenario: Session card shows user prompt count excluding tool calls
Given the user views a session card
When the metadata is displayed
Then a count of user prompts that are not tool calls is shown in the format 'XX msgs (YY prompts)'

---

## Feature: Session Viewer — Collapsible Cards and Ellipsis Grouping

### Scenario: Each message displays its type badge exactly once
Given the user views a session page
When messages are rendered
Then each message's type badge appears exactly once per message in the EntryCard header

### Scenario: ai-title card displays title in header with no card body
Given the user views a session page containing an ai-title message
When the ai-title card is rendered
Then the title appears in the card header and no card body is shown

### Scenario: FileSnapshot with no tracked files displays that state in header
Given the user views a session page containing a FileSnapshot message with no tracked files
When the card is rendered
Then the card header indicates no files are tracked and no card body is rendered

### Scenario: Non-user-message cards are collapsed by default showing minimal header info
Given the user views a session page
When non-user-message cards are rendered
Then they are collapsed showing only minimal header information

### Scenario: Expanding a collapsed card reveals full content
Given a collapsed card is visible on the session page
When the user expands it
Then full card content including the body becomes visible

### Scenario: User message cards are expanded by default
Given the user views a session page
When user message cards are rendered
Then they are fully expanded by default

### Scenario: Tool-result user message displays amber badge and is collapsed by default
Given the user views a session page containing a user message that is a tool result
When the card is rendered
Then the card header displays an amber 'tool result' badge distinguishing it from a regular user message, and the card is collapsed by default

### Scenario: Consecutive non-user messages hidden behind ellipsis with count
Given the user views a session page with multiple consecutive non-user messages between two user messages
When the session is rendered
Then the non-user messages are hidden behind an ellipsis showing their count

### Scenario: Clicking the ellipsis expands hidden messages
Given an ellipsis indicator is visible on the session page
When the user clicks the ellipsis indicator
Then all previously hidden messages expand and become visible

### Scenario: Long sessions load additional messages when many are hidden
Given the user views a session where most messages are hidden due to ellipsis grouping
When the visible message count drops significantly
Then the system loads more messages automatically so that sufficient visible content is available

### Scenario: Session detail page shows the same metadata summary as session card
Given the user opens a session detail page
When the page loads
Then they see the same metadata summary including title, plan indicator, agent, session ID, message and prompt count, date range, duration, and file size that appears on the session card in the session list

---

## Feature: Vibe Coder Personality Test

### Scenario: Receive a named personality type with trait breakdown from the test
Given the personality test has been run against the user's codebase and git history
When the test completes
Then the user receives a named personality type with trait breakdown

### Scenario: Review draft plan before implementation proceeds
Given a draft plan for trait definitions and measurement methods has been produced
When the user reviews the draft plan
Then the user can provide feedback before implementation proceeds

### Scenario: All Claude Code projects pre-selected by default on launch
Given the personality test UI is launched
When the initial screen is shown
Then all Claude Code projects on the machine are selected by default

### Scenario: Exclude specific projects before running the test
Given the user is on the personality test launch screen with all projects selected
When the user excludes specific projects from the analysis
Then the results reflect only the included projects

### Scenario: Result mapped to one of approximately 8 named archetypes
Given the personality test has analysed the user's data
When the result is displayed
Then the user receives a personality result mapped to one of approximately 8 named archetypes

### Scenario: Copy plan file to the intent/vibe-personality directory
Given the personality test plan file exists
When the user requests the plan file be copied to the intent/vibe-personality directory
Then the file is placed at that path

---

## Feature: Claude Permission Event Observability

### Scenario: Determine whether permission prompt events are captured in session logs
Given the user has access to session logs in ~/.claude
When the user reviews those logs to determine whether permission request events are captured
Then the user understands the event presence and structure

### Scenario: Determine whether permission mode change events are captured
Given the user has access to session logs in ~/.claude
When the user reviews those logs to determine whether permission mode change events are recorded
Then the user understands how mode switch recording works

### Scenario: Distinguish agreement, decline, and alternative instructions in JSON examples
Given JSON examples are provided for each of the three response types to permission prompts
When the user examines those examples
Then the user can parse and distinguish agreement, decline, and alternative instructions response types

### Scenario: Infer that a tool was invoked without a corresponding permission prompt
Given the user is inspecting session logs for a tool invocation
When no corresponding permission prompt event appears for that invocation
Then the user can infer that the active mode suppressed the prompt

### Scenario: Save permissions observability report to intent/vibe-personality/permissions.md
Given the permissions observability research is complete
When the user saves the report to intent/vibe-personality/permissions.md
Then persistent documentation is stored at that path for future reference

### Scenario: Retrieve the persisted report from intent/vibe-personality/permissions.md
Given the permissions observability report has been saved
When the user retrieves the report from intent/vibe-personality/permissions.md
Then the user gains understanding of what session log signals are available for permission event analysis

---

## Feature: Worktree-Based Session Discovery

### Scenario: Sessions from original repo directory found when launching from a worktree
Given the user launches the tool from a git worktree
When session discovery runs
Then sessions stored in the original repo directory are discovered and shown

### Scenario: Sessions from all worktrees collected and presented together
Given the user has multiple worktrees for a repository
When session discovery runs
Then sessions from all worktrees are collected and presented in a unified list

---

## Feature: Graceful Handling of Non-Standard Git Repositories

### Scenario: Process files from a git repo with no commits
Given the user runs the tool on a project with no git commits
When the tool executes
Then it still processes and includes the files present in the repo directory rather than skipping them

### Scenario: Handle a non-git project directory without crashing
Given the user runs the tool on a project directory not under git version control
When the tool executes
Then it handles the project gracefully without requiring git

### Scenario: Skip repo URL prompt when no git remotes are configured
Given the user is uploading an archive from a directory with no git remotes
When the upload flow runs
Then the repo URL prompt is skipped entirely

### Scenario: Upload success message does not include a download URL
Given the user has completed an upload
When the success message is displayed
Then no download URL line is shown in the success output

---

## Feature: Sessions Consolidation with Feature Flag

### Scenario: Single Sessions tab shows static agent list when preview is disabled
Given the sessions preview feature flag is disabled
When the user views the review screen
Then a single Sessions tab appears showing agent names and session counts as a static list

### Scenario: Single Sessions tab enables interactive agent drill-down when preview is enabled
Given the sessions preview feature flag is enabled
When the user views the review screen
Then a single Sessions tab appears and selecting an agent drills into a full interactive agent tab with session preview

### Scenario: Sessions tab is not shown for projects with no agents
Given a project has no agents
When the user views the review screen
Then the Sessions tab is not shown

---

## Feature: Session Viewer — Cursor Session Display

### Scenario: Opening a Cursor session displays its messages
Given the user is viewing a project with Cursor sessions in the Review screen
When the user opens a Cursor session for a project
Then the session messages are displayed rather than showing 'No messages found in this session'

---

## Feature: Session Count and Cursor Session Discovery Regression Prevention

### Scenario: Session discovery enumerates all sessions without missing or duplicating any
Given session discovery logic is implemented for cursor sessions
When the discovery runs
Then all cursor sessions are correctly and completely enumerated without missing or duplicating any

### Scenario: Receive a concrete fix and testing plan for session discovery issues
Given session discovery logic is suspected to overlook or handle sessions inconsistently
When the user requests a detailed fix and testing plan
Then a concrete plan is returned covering both the fix approach and regression prevention through cross-checking and automated tests