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

//TODO: figure out a better structure such that you can test deploy parts of the infrasture easier
export class CdkTestStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const ECS_BACKEND_REPO_ARN: string = process.env.ECS_BACKEND_REPO_ARN ?? ""
    const ECS_BACKEND_TASK_EXECUTION_ROLE: string = process.env.ECS_BACKEND_TASK_EXECUTION_ROLE ?? ""

    const vpc = new ec2.Vpc(this, 'my-test-vpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      availabilityZones: ["eu-central-1a", "eu-central-1b"],
      enableDnsHostnames: false

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


    const discoveryServiceRepository = ecr.Repository.fromRepositoryAttributes(this, 'discovery-test-repo', {
      repositoryArn: ECS_BACKEND_REPO_ARN,
      repositoryName: 'discovery-test',
    });

    const frontendServiceRepository = ecr.Repository.fromRepositoryAttributes(this, 'frontend-test-repo', {
      repositoryArn: ECS_BACKEND_REPO_ARN,
      repositoryName: 'frontend-testo',
    });

    const ecsClusterTaskExecutionRole = iam.Role.fromRoleArn(this, 'ecsTaskExecutionRole', ECS_BACKEND_TASK_EXECUTION_ROLE, {
      mutable: false
    });

    const ecsBackendLoadBalancer = new elbv2.ApplicationLoadBalancer(this, 'LB', {
      vpc,
      internetFacing: true
    });


    const ecsLBListener = ecsBackendLoadBalancer.addListener('Listener', {
      port: 5000,
      protocol: ApplicationProtocol.HTTP,
      open: true,
    });


    const ecsLBTargetGroup = ecsLBListener.addTargets('ApplicationFleet', {
      port: 4200,
      protocol: ApplicationProtocol.HTTP,
      priority: 1,
      conditions: [
        elbv2.ListenerCondition.pathPatterns(['/', '/start'])
      ]
    });


    const ecsLBTargetGroup2 = ecsLBListener.addTargets('ApplicationFleet2', {
      port: 5000,
      priority: 2,
      protocol: ApplicationProtocol.HTTP,
      conditions: [
        elbv2.ListenerCondition.pathPatterns(['/read'])
      ]
    });

    ecsLBListener.addTargetGroups("Bla", {targetGroups: [ecsLBTargetGroup, ecsLBTargetGroup2]})


    const ecsBackendTaskDefinition = new FargateTaskDefinition(this, 'DefaultTask', {
      family: 'DefaultTask',
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


    const ecsDiscoveryTaskDefinition = new FargateTaskDefinition(this, 'DiscoveryTask', {
      family: 'DefaultTask',
      taskRole: ecsClusterTaskExecutionRole,
      executionRole: ecsClusterTaskExecutionRole,
    });

    ecsDiscoveryTaskDefinition.addContainer('test-discovery-service', {
      image: ecs.ContainerImage.fromEcrRepository(discoveryServiceRepository, 'latest'),
      portMappings: [{ hostPort: 5001, containerPort: 5001, protocol: ecs.Protocol.TCP, name: "discoverypm" }],
      environment: { "SD_HOST_NAME": "mybackend:5000" },
    });


    const ecsFrontendTaskDefinition = new FargateTaskDefinition(this, 'FrontendTask', {
      family: 'DefaultTask',
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


    const discoveryService = new ecs.FargateService(this, 'DiscoveryService', {
      cluster: ecsCluster,
      taskDefinition: ecsDiscoveryTaskDefinition,
      desiredCount: 1,
      assignPublicIp: false,
      securityGroups: [ecsClusterSecurityGroup],
      serviceConnectConfiguration: { namespace: "testCmNs", services: [{ portMappingName: "discoverypm", dnsName: "mydiscovery" }] }
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
