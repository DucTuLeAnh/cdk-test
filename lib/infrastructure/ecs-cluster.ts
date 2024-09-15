import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { FargateService, FargateTaskDefinition } from 'aws-cdk-lib/aws-ecs';

export class EcsCluster extends Construct {

    securityGroup: ec2.SecurityGroup
    cluster: ecs.Cluster
    backendRepository: ecr.IRepository
    frontendServiceRepository: ecr.IRepository
    ecsClusterTaskExecutionRole: iam.IRole
    backendService: FargateService
    frontendService: FargateService

    constructor(scope: Construct, id: string, vpc: ec2.Vpc) {
        super(scope, id)

        const ECS_BACKEND_REPO_ARN: string = process.env.ECS_BACKEND_REPO_ARN ?? ""
        const ECS_BACKEND_TASK_EXECUTION_ROLE: string = process.env.ECS_BACKEND_TASK_EXECUTION_ROLE ?? ""

        this.securityGroup = new ec2.SecurityGroup(this, id + '-' + 'ecs-backend-sg', {
            vpc: vpc,
            allowAllOutbound: true
        });

        //TODO: check out security best practices in terms of allowing IP's
        this.securityGroup.addIngressRule(
            this.securityGroup,
            ec2.Port.allTraffic(),
            'Allow all inbound traffic from within the security group'
        );

        this.securityGroup.addIngressRule(
            ec2.Peer.anyIpv4(),
            ec2.Port.tcp(5000),
            'Allow all inbound traffic on port 5000'
        );
        this.securityGroup.addEgressRule(
            ec2.Peer.anyIpv4(),
            ec2.Port.tcp(5000),
            'Allow all TCP connections on port 5000 to destination 0.0.0.0/0'
        );

        this.securityGroup.addIngressRule(
            ec2.Peer.anyIpv4(),
            ec2.Port.tcp(5001),
            'Allow all inbound traffic on port 5001'
        );
        this.securityGroup.addEgressRule(
            ec2.Peer.anyIpv4(),
            ec2.Port.tcp(5001),
            'Allow all TCP connections on port 5001 to destination 0.0.0.0/0'
        );

        this.cluster = new ecs.Cluster(this, id + '-' + "ecsc", {
            vpc: vpc
        });

        this.cluster.addDefaultCloudMapNamespace({
            name: id + '-' + "testCmNs",
            useForServiceConnect: true
        })

        this.backendRepository = ecr.Repository.fromRepositoryAttributes(this, id + '-' + 'test-repo', {
            repositoryArn: ECS_BACKEND_REPO_ARN,
            repositoryName: 'test',
        });

        this.frontendServiceRepository = ecr.Repository.fromRepositoryAttributes(this, id + '-' + 'frontend-test-repo', {
            repositoryArn: ECS_BACKEND_REPO_ARN,
            repositoryName: 'frontend-testo',
        });

        this.ecsClusterTaskExecutionRole = iam.Role.fromRoleArn(this, id + '-' + 'ecsTaskExecutionRole', ECS_BACKEND_TASK_EXECUTION_ROLE, {
            mutable: false
        });


        const ecsBackendTaskDefinition = new FargateTaskDefinition(this, id + '-' + 'BackendTask', {
            taskRole: this.ecsClusterTaskExecutionRole,
            executionRole: this.ecsClusterTaskExecutionRole,
        });

        const dbCryptKey = ssm.StringParameter.fromSecureStringParameterAttributes(this, 'MY_DB_CRYPT_KEY', { parameterName: 'MY_DB_CRYPT_KEY' });
        const dbCryptSecret = ssm.StringParameter.fromSecureStringParameterAttributes(this, 'MY_DB_CRYPT_SECRET', { parameterName: 'MY_DB_CRYPT_SECRET' });

        ecsBackendTaskDefinition.addContainer(id + '-' + 'backend-task', {
            image: ecs.ContainerImage.fromEcrRepository(this.backendRepository, 'latest'),
            portMappings: [{ hostPort: 5000, containerPort: 5000, protocol: ecs.Protocol.TCP, name: id + '-' + "backendpm" }],
            environment: { "SD_HOST_NAME": "test" },
            secrets: {
                "TWS_ACCESS_KEY_ID": ecs.Secret.fromSsmParameter(dbCryptKey),
                "TWS_SECRET_ACCESS_KEY": ecs.Secret.fromSsmParameter(dbCryptSecret)
            }
        });

        const ecsFrontendTaskDefinition = new FargateTaskDefinition(this, id + '-' + 'FrontendTask', {
            taskRole: this.ecsClusterTaskExecutionRole,
            executionRole: this.ecsClusterTaskExecutionRole,
        });

        ecsFrontendTaskDefinition.addContainer(id + '-' + 'test-frontend', {
            image: ecs.ContainerImage.fromEcrRepository(this.frontendServiceRepository, 'latest'),
            portMappings: [{ hostPort: 4200, containerPort: 4200, protocol: ecs.Protocol.TCP, name: id + '-' + "frontendpm" }],
        });

        this.backendService = new ecs.FargateService(this, id + '-' + 'Service', {
            cluster: this.cluster,
            taskDefinition: ecsBackendTaskDefinition,
            desiredCount: 1,
            assignPublicIp: false,
            securityGroups: [this.securityGroup],
            serviceConnectConfiguration: { namespace: id + '-' + "testCmNs", services: [{ portMappingName: id + '-' + "backendpm", dnsName: id + '-' + "mybackend" }] }
        });

        this.frontendService = new ecs.FargateService(this, id + '-' + 'FrontendService', {
            cluster: this.cluster,
            taskDefinition: ecsFrontendTaskDefinition,
            desiredCount: 1,
            assignPublicIp: false,
            securityGroups: [this.securityGroup],
            serviceConnectConfiguration: { namespace: id + '-' + "testCmNs", services: [{ portMappingName: id + '-' + "frontendpm", dnsName: id + '-' + "myfrontend" }] }
        });

    }
}