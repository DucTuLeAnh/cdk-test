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
import { ApplicationProtocol } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { TableV2 } from 'aws-cdk-lib/aws-dynamodb';

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

    const ecsBackendSecurityGroup = new ec2.SecurityGroup(this, 'ecs-backend-sg', {
      vpc: vpc,
      allowAllOutbound: true
    });

    //TODO: check out security best practices in terms of allowing IP's
    ecsBackendSecurityGroup.addIngressRule(
      ecsBackendSecurityGroup,
      ec2.Port.allTraffic(),
      'Allow all inbound traffic from within the security group'
    );

    ecsBackendSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(5000),
      'Allow all inbound traffic on port 5000'
    );
    ecsBackendSecurityGroup.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(5000),
      'Allow all TCP connections on port 5000 to destination 0.0.0.0/0'
    );

    const ecsCluster = new ecs.Cluster(this, "ecs-test-cluster", {
      vpc: vpc
    });

    const backendRepository = ecr.Repository.fromRepositoryAttributes(this, 'test-repo', {
      repositoryArn: ECS_BACKEND_REPO_ARN,
      repositoryName: 'test',
    });

    const ecsBackendTaskExecutionRole = iam.Role.fromRoleArn(this, 'ecsTaskExecutionRole', ECS_BACKEND_TASK_EXECUTION_ROLE, {
      mutable: false
    });

    const ecsBackendLoadBalancer = new elbv2.ApplicationLoadBalancer(this, 'LB', {
      vpc,
      internetFacing: true
    });

    const ecsBackendLBListener = ecsBackendLoadBalancer.addListener('Listener', {
      port: 80,
      open: true
    });

    const ecsBackendTargetGroup = ecsBackendLBListener.addTargets('ApplicationFleet', {
      port: 5000,
      protocol: ApplicationProtocol.HTTP
    });

    const ecsBackendTaskDefinition = new FargateTaskDefinition(this, 'DefaultTask', {
      family: 'DefaultTask',
      taskRole: ecsBackendTaskExecutionRole,
      executionRole: ecsBackendTaskExecutionRole,
    });

    const dbCryptKey = ssm.StringParameter.fromSecureStringParameterAttributes(this, 'MY_DB_CRYPT_KEY', {parameterName: 'MY_DB_CRYPT_KEY'});
    const dbCryptSecret = ssm.StringParameter.fromSecureStringParameterAttributes(this, 'MY_DB_CRYPT_SECRET', {parameterName: 'MY_DB_CRYPT_SECRET'});
    ecsBackendTaskDefinition.addContainer('test-backend-container', {
      image: ecs.ContainerImage.fromEcrRepository(backendRepository, 'latest'),
      portMappings: [{ hostPort: 5000, containerPort: 5000, protocol: ecs.Protocol.TCP }],
      environment: { "SD_HOST_NAME": "test" },
      secrets: {
        "TWS_ACCESS_KEY_ID": ecs.Secret.fromSsmParameter(dbCryptKey),
        "TWS_SECRET_ACCESS_KEY": ecs.Secret.fromSsmParameter(dbCryptSecret)
      }
    });

    const service = new ecs.FargateService(this, 'Service', {
      cluster: ecsCluster,
      taskDefinition: ecsBackendTaskDefinition,
      desiredCount: 1,
      assignPublicIp: false,
      securityGroups: [ecsBackendSecurityGroup],
    });

    ecsBackendTargetGroup.addTarget(service)

    // here come the DB stuff
    const table: TableV2 = new dynamodb.TableV2(this, 'TestUsers', {
      partitionKey: { name: 'email', type: dynamodb.AttributeType.STRING },
    });


  }
}
