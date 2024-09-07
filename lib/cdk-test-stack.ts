import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { FargateTaskDefinition } from 'aws-cdk-lib/aws-ecs';
import { ApplicationListenerRule, ApplicationProtocol } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as elbActions from 'aws-cdk-lib/aws-elasticloadbalancingv2-actions';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { LoadBalancerTarget } from 'aws-cdk-lib/aws-route53-targets';
import { PublicHostedZone } from 'aws-cdk-lib/aws-route53';

//TODO: figure out a better structure such that you can test deploy parts of the infrasture easier
export class CdkTestStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const ECS_BACKEND_REPO_ARN: string = process.env.ECS_BACKEND_REPO_ARN ?? ""
    const ECS_BACKEND_TASK_EXECUTION_ROLE: string = process.env.ECS_BACKEND_TASK_EXECUTION_ROLE ?? ""
    const HOSTED_ZONE_ID: string = process.env.HOSTED_ZONE_ID ?? ""
    const ZONE_NAME: string = process.env.ZONE_NAME ?? ""

    //COGNITO CONFIG

    const userPool = new cognito.UserPool(this, 'MyUserPool', {
      userPoolName: 'MyAppUserPool',
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireSymbols: true,
        requireUppercase: true,
      },
    });

    const userPoolClient = new cognito.UserPoolClient(this, 'MyUserPoolClient', {
      userPool,
      generateSecret: true,
      oAuth: {
        callbackUrls: ['https://johndoestestapp.de', 'https://johndoestestapp.de/oauth2/idpresponse'],  // Add your redirect URLs here
        //logoutUrls: ['https://johndoestestapp.de/'],  // Add your sign-out URLs here
        flows: {
          authorizationCodeGrant: true,  // Enable the authorization code grant flow
        },
      },
    });

    const domain = new cognito.UserPoolDomain(this, 'CognitoDomain', {
      userPool,
      cognitoDomain: {
        domainPrefix: 'mytest-domain-34444',
      },
    });


    const vpc = new ec2.Vpc(this, 'my-test-vpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      availabilityZones: ["eu-central-1a", "eu-central-1b"],
      enableDnsHostnames: false

    });

    // Assuming your domain is already registered in Route 53 TODO: put domain names in environment variables
    /*
    const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName: 'johndoestestapp.de',
    });
    */

    const hostedZone = PublicHostedZone.fromHostedZoneAttributes(
      this,
      'HostedZone',
      { hostedZoneId: HOSTED_ZONE_ID, zoneName: ZONE_NAME }
    )

    // Request a certificate for your domain
    const certificate = new acm.Certificate(this, 'Certificate', {
      domainName: 'johndoestestapp.de',
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });


    const ecsClusterSecurityGroup = new ec2.SecurityGroup(this, 'ecs-backend-sg', {
      vpc: vpc,
      allowAllOutbound: true
    });

    //TODO: check out security best practices in terms of allowing IP's
    ecsClusterSecurityGroup.addIngressRule(
      ecsClusterSecurityGroup,
      ec2.Port.allTraffic(),
      'Allow all inbound traffic from within the security group'
    );

    ecsClusterSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(5000),
      'Allow all inbound traffic on port 5000'
    );
    ecsClusterSecurityGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(5000),
      'Allow all TCP connections on port 5000 to destination 0.0.0.0/0'
    );


    ecsClusterSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(5001),
      'Allow all inbound traffic on port 5001'
    );
    ecsClusterSecurityGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(5001),
      'Allow all TCP connections on port 5001 to destination 0.0.0.0/0'
    );

    const ecsCluster = new ecs.Cluster(this, "ecs-test-cluster", {
      vpc: vpc
    });

    ecsCluster.addDefaultCloudMapNamespace({
      name: "testCmNs",
      useForServiceConnect: true
    })

    const backendRepository = ecr.Repository.fromRepositoryAttributes(this, 'test-repo', {
      repositoryArn: ECS_BACKEND_REPO_ARN,
      repositoryName: 'test',
    });

    const frontendServiceRepository = ecr.Repository.fromRepositoryAttributes(this, 'frontend-test-repo', {
      repositoryArn: ECS_BACKEND_REPO_ARN,
      repositoryName: 'frontend-testo',
    });

    const ecsClusterTaskExecutionRole = iam.Role.fromRoleArn(this, 'ecsTaskExecutionRole', ECS_BACKEND_TASK_EXECUTION_ROLE, {
      mutable: false
    });

    const ecsLoadBalancer = new elbv2.ApplicationLoadBalancer(this, 'LB', {
      vpc,
      internetFacing: true
    });


    const ecsLBListener = ecsLoadBalancer.addListener('Listener', {
      port: 443,
      protocol: ApplicationProtocol.HTTPS,
      certificates: [certificate],
      open: true,
    });
    // Optional: Add a listener for HTTP traffic and redirect it to HTTPS
    const httpListener = ecsLoadBalancer.addListener('HttpListener', {
      port: 80,
      defaultAction: elbv2.ListenerAction.redirect({
        protocol: 'HTTPS',
        port: '443',
      }),
    });


    const ecsLBTargetGroup = ecsLBListener.addTargets('ApplicationFleet', {
      port: 4200,
      protocol: ApplicationProtocol.HTTP,
      priority: 99,
      conditions: [
        elbv2.ListenerCondition.pathPatterns(['/'])
      ]
    });


    const ecsLBTargetGroup2 = ecsLBListener.addTargets('ApplicationFleet2', {
      port: 5000,
      priority: 1,
      protocol: ApplicationProtocol.HTTP,
      conditions: [
        elbv2.ListenerCondition.pathPatterns(['/read'])
      ]
    });


    ecsLBListener.addTargetGroups("Bla", {targetGroups: [ecsLBTargetGroup2] })

    // Create an Alias record to point to the ALB
    new route53.ARecord(this, 'AliasRecord', {
      zone: hostedZone,
      target: route53.RecordTarget.fromAlias(new LoadBalancerTarget(ecsLoadBalancer)),
      // If pointing to the root domain (example.com):
      recordName: '', // leave this empty
      // If pointing to a subdomain (www.example.com):
      // recordName: 'www',
    });

    ecsLBListener.addAction('CognitoAuth', {
      action: new elbActions.AuthenticateCognitoAction({
        userPool: userPool,
        userPoolClient: userPoolClient,
        userPoolDomain: domain,
        next: elbv2.ListenerAction.forward([ecsLBTargetGroup]),
      }),
      conditions: [elbv2.ListenerCondition.pathPatterns(['/'])],
      priority: 2,
    });


    const ecsBackendTaskDefinition = new FargateTaskDefinition(this, 'BackendTask', {
      taskRole: ecsClusterTaskExecutionRole,
      executionRole: ecsClusterTaskExecutionRole,
    });

    const dbCryptKey = ssm.StringParameter.fromSecureStringParameterAttributes(this, 'MY_DB_CRYPT_KEY', { parameterName: 'MY_DB_CRYPT_KEY' });
    const dbCryptSecret = ssm.StringParameter.fromSecureStringParameterAttributes(this, 'MY_DB_CRYPT_SECRET', { parameterName: 'MY_DB_CRYPT_SECRET' });

    ecsBackendTaskDefinition.addContainer('test-backend-container', {
      image: ecs.ContainerImage.fromEcrRepository(backendRepository, 'latest'),
      portMappings: [{ hostPort: 5000, containerPort: 5000, protocol: ecs.Protocol.TCP, name: "backendpm" }],
      environment: { "SD_HOST_NAME": "test" },
      secrets: {
        "TWS_ACCESS_KEY_ID": ecs.Secret.fromSsmParameter(dbCryptKey),
        "TWS_SECRET_ACCESS_KEY": ecs.Secret.fromSsmParameter(dbCryptSecret)
      }
    });


    const ecsFrontendTaskDefinition = new FargateTaskDefinition(this, 'FrontendTask', {
      taskRole: ecsClusterTaskExecutionRole,
      executionRole: ecsClusterTaskExecutionRole,
    });

    ecsFrontendTaskDefinition.addContainer('test-frontend', {
      image: ecs.ContainerImage.fromEcrRepository(frontendServiceRepository, 'latest'),
      portMappings: [{ hostPort: 4200, containerPort: 4200, protocol: ecs.Protocol.TCP, name: "frontendpm" }],
    });

    const backendService = new ecs.FargateService(this, 'Service', {
      cluster: ecsCluster,
      taskDefinition: ecsBackendTaskDefinition,
      desiredCount: 1,
      assignPublicIp: false,
      securityGroups: [ecsClusterSecurityGroup],
      serviceConnectConfiguration: { namespace: "testCmNs", services: [{ portMappingName: "backendpm", dnsName: "mybackend" }] }
    });

    const frontendService = new ecs.FargateService(this, 'FrontendService', {
      cluster: ecsCluster,
      taskDefinition: ecsFrontendTaskDefinition,
      desiredCount: 1,
      assignPublicIp: false,
      securityGroups: [ecsClusterSecurityGroup],
      serviceConnectConfiguration: { namespace: "testCmNs", services: [{ portMappingName: "frontendpm", dnsName: "myfrontend" }] }
    });

    ecsLBTargetGroup.addTarget(frontendService)
    ecsLBTargetGroup2.addTarget(backendService)

    // here come the DB stuff
    const table: TableV2 = new dynamodb.TableV2(this, 'TestUsers', {
      partitionKey: { name: 'email', type: dynamodb.AttributeType.STRING },
    });

  }
}
