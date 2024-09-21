
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { ApplicationProtocol, ApplicationTargetGroup } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as elbActions from 'aws-cdk-lib/aws-elasticloadbalancingv2-actions';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { LoadBalancerTarget } from 'aws-cdk-lib/aws-route53-targets';
import { CognitoAuth } from './cognito-auth';
import { DomainHost } from './domain-host';

export class AppLoadBalancer extends Construct {

    frontendTargetGroup: ApplicationTargetGroup
    backendTargetGroup: ApplicationTargetGroup
    constructor(scope: Construct, id: string, vpc: ec2.Vpc) {
        super(scope, id)

        const cognitoAuth = new CognitoAuth(this, id +"-"+"aca")
        const ecsLoadBalancer = new elbv2.ApplicationLoadBalancer(this, id + "-" +'lb', {
            vpc: vpc,
            internetFacing: true
        });

        const domainHost = new DomainHost(this, id + "-" +"domain", route53.RecordTarget.fromAlias(new LoadBalancerTarget(ecsLoadBalancer)))

        const ecsLBListener = ecsLoadBalancer.addListener(id + '-' + 'Listener', {
            port: 443,
            protocol: ApplicationProtocol.HTTPS,
            certificates: [domainHost.hostCertificate],
            open: true,
        });
        // Optional: Add a listener for HTTP traffic and redirect it to HTTPS
        const httpListener = ecsLoadBalancer.addListener(id + '-' + 'HttpListener', {
            port: 80,
            defaultAction: elbv2.ListenerAction.redirect({
                protocol: 'HTTPS',
                port: '443',
            }),
        });


        this.frontendTargetGroup = ecsLBListener.addTargets(id + '-' +'FrontendAppFleet', {
            port: 4200,
            protocol: ApplicationProtocol.HTTP,
            priority: 99,
            conditions: [
                elbv2.ListenerCondition.pathPatterns(['/'])
            ]
        });


        this.backendTargetGroup = ecsLBListener.addTargets(id + '-' + 'BackendAppFleet', {
            port: 5000,
            priority: 1,
            protocol: ApplicationProtocol.HTTP,
            conditions: [
                elbv2.ListenerCondition.pathPatterns(['/read'])
            ]
        });

        ecsLBListener.addTargetGroups(id + '-' +"BackendTargetGroup", { targetGroups: [this.backendTargetGroup] })

        ecsLBListener.addAction(id  + '-' + 'CognitoAction', {
            action: new elbActions.AuthenticateCognitoAction({
                userPool: cognitoAuth.userPool,
                userPoolClient: cognitoAuth.userPoolClient,
                userPoolDomain: cognitoAuth.userPoolDomain,
                next: elbv2.ListenerAction.forward([this.frontendTargetGroup]),
            }),
            conditions: [elbv2.ListenerCondition.pathPatterns(['/'])],
            priority: 2,
        });

    }



}