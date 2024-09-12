
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

export class VpcConfig extends Construct {

    vpc: ec2.Vpc

    constructor(scope: Construct, id: string) {
        super(scope, id)

        this.vpc = new ec2.Vpc(this, 'my-test-vpc', {
            ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
            availabilityZones: ["eu-central-1a", "eu-central-1b"],
            enableDnsHostnames: false

        });
    }

}