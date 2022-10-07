# MerLoc universal (runtime agnostic) GateKeeper

![Build Status](https://github.com/thundra-io/merloc-gatekeeper-aws-lambda-extension/actions/workflows/build.yml/badge.svg)
![license](https://img.shields.io/badge/License-Apache_2.0-blue.svg)

This project provides **universal** (runtime agnostic) `GateKeeper`component implementation based on AWS Lambda extension
to be able to use [MerLoc](https://github.com/thundra-io/merloc) as live AWS Lambda development tool.

> **Note** that, to be able to use MerLoc universal GateKeeper component,
> first you need to setup MerLoc platform into your AWS account
> as explained at MerLoc Github page [here](https://github.com/thundra-io/merloc).

## 1. Setup

- Add MerLoc GateKeeper layer: `arn:aws:lambda:${region}:269863060030:layer:merloc-gatekeeper:${version}`

  You can use the latest layer version (shown below) instead of the `${version}` above:

  ![merloc-gatekeeper](https://api.globadge.com/v1/badgen/aws/lambda/layer/latest-version/us-east-1/269863060030/merloc-gatekeeper) (badge powered by [Globadge serverless](https://www.globadge.com/badges/serverless))

  Note that the region of the ARN is dynamic, so you need to change it accordingly to the region where you deploy your function.
  So let’s say that you deploy your Lambda function to the `Oregon` (`us-west-2`) region.
  So the layer ARN will be: `arn:aws:lambda:us-west-2:269863060030:layer:merloc-gatekeeper:${version}`

- Set `AWS_LAMBDA_EXEC_WRAPPER` environment variable to `/opt/extensions/merloc-gatekeeper-ext/bootstrap`

> **Warning**
> `Java 8 on Amazon Linux 1` runtime is not supported

- Set `MERLOC_BROKER_URL` environment variable to the
    - value of the `merloc-broker.merlocbrokerwsapistageurl` property which you get from AWS CDK broker setup output as shown in the example below:
      ![Broker URL From AWS CDK Output](./assets/broker-url-from-aws-cdk-output.png)

    - **or** value of the `merlocbrokerwsapistageurl` property which you get from AWS CloudFormation broker setup output as shown in the example below:
      ![Broker URL From AWS CloudFormation Output](./assets/broker-url-from-aws-cf-output.png)
    
## 2. Configuration

- `MERLOC_BROKER_URL`: This configuration is **MANDATORY**.
  You need to set this environment variable by broker URL
  as mentioned in the [GateKeeper Setup](#1-setup) section.

- `MERLOC_ENABLE`: This configuration is **OPTIONAL**.
  Even though MerLoc GateKeeper layer is added and configured,
  you can disable it by setting the `MERLOC_ENABLE` environment variable to `false`.
  For example,
  ```
  MERLOC_ENABLE=false
  ```

- `MERLOC_DEBUG_ENABLE`: This configuration is **OPTIONAL**.
  By default, internal debug logs are disabled,
  but you can enable it by setting the `MERLOC_DEBUG_ENABLE` environment variable to `true`.
  For example,
  ```
  MERLOC_DEBUG_ENABLE=true
  ```

- `MERLOC_BROKER_CONNECTION_NAME`: This configuration is **OPTIONAL**.
  By default, the name of the connection to the broker is the name of the AWS Lambda function for GateKeeper.
  But you can change it by setting the `MERLOC_BROKER_CONNECTION_NAME` environment variable.
  For example,
  ```
  MERLOC_BROKER_CONNECTION_NAME=serkan-connection
  ```

## 3. Limitations

- If the resources (AWS RDS, AWS OpenSearch/Elasticsearch, AWS ElastiCache, etc ...) you are accessing inside the function are deployed inside a VPC,
  your local needs to have access to resources in the VPC.
  So you need to setup a VPN connection from your local machine to the VPC network.
  You can check [this AWS blog post](https://aws.amazon.com/tr/blogs/networking-and-content-delivery/introducing-aws-client-vpn-to-securely-access-aws-and-on-premises-resources/)
  to learn how to do that.

- Currently, AWS Lambda layers are not supported. So if you use layers, they will not be available on your local
  while running function locally as MerLoc doesn't download and extract layers onto your local environment.

## 4. Issues and Feedback

[![Issues](https://img.shields.io/github/issues/thundra-io/merloc-gatekeeper-aws-lambda-extension.svg)](https://github.com/thundra-io/merloc-gatekeeper-aws-lambda-extension/issues?q=is%3Aopen+is%3Aissue)
[![Closed issues](https://img.shields.io/github/issues-closed/thundra-io/merloc-gatekeeper-aws-lambda-extension.svg)](https://github.com/thundra-io/merloc-gatekeeper-aws-lambda-extension/issues?q=is%3Aissue+is%3Aclosed)

Please use [GitHub Issues](https://github.com/thundra-io/merloc-gatekeeper-aws-lambda-extension/issues) for any bug report, feature request and support.

## 5. Contribution

[![Pull requests](https://img.shields.io/github/issues-pr/thundra-io/merloc-gatekeeper-aws-lambda-extension.svg)](https://github.com/thundra-io/merloc-gatekeeper-aws-lambda-extension/pulls?q=is%3Aopen+is%3Apr)
[![Closed pull requests](https://img.shields.io/github/issues-pr-closed/thundra-io/merloc-gatekeeper-aws-lambda-extension.svg)](https://github.com/thundra-io/merloc-gatekeeper-aws-lambda-extension/pulls?q=is%3Apr+is%3Aclosed)
[![Contributors](https://img.shields.io/github/contributors/thundra-io/merloc-gatekeeper-aws-lambda-extension.svg)]()

If you would like to contribute, please
- Fork the repository on GitHub and clone your fork.
- Create a branch for your changes and make your changes on it.
- Send a pull request by explaining clearly what is your contribution.

> Tip: 
> Please check the existing pull requests for similar contributions and 
> consider submit an issue to discuss the proposed feature before writing code.

## 6. License

Licensed under [Apache License 2.0](LICENSE).
