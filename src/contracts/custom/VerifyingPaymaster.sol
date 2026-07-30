// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IEntryPoint {
    function depositTo(address account) external payable;
    function getDepositInfo(address account) external view returns (uint112 deposit, bool staked, uint112 stake, uint32 unstakeDelaySec, uint48 withdrawTime);
    function withdrawTo(address payable withdrawAddress, uint256 withdrawAmount) external;
}

/**
 * @title VerifyingPaymaster
 * @notice Standard ERC-4337 Verifying Paymaster for sponsoring UserOperation gas fees on Base.
 * Off-chain service signs UserOps using an authorized offChainSigner private key (e.g., Thirdweb admin key).
 */
contract VerifyingPaymaster {
    IEntryPoint public immutable entryPoint;
    address public owner;
    address public verifyingSigner;

    event VerifyingSignerChanged(address indexed oldSigner, address indexed newSigner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "VerifyingPaymaster: caller is not the owner");
        _;
    }

    modifier onlyEntryPoint() {
        require(msg.sender == address(entryPoint), "VerifyingPaymaster: caller is not EntryPoint");
        _;
    }

    constructor(IEntryPoint _entryPoint, address _verifyingSigner) {
        require(address(_entryPoint) != address(0), "Invalid EntryPoint");
        require(_verifyingSigner != address(0), "Invalid verifyingSigner");
        entryPoint = _entryPoint;
        verifyingSigner = _verifyingSigner;
        owner = msg.sender;
    }

    function setVerifyingSigner(address _newSigner) external onlyOwner {
        require(_newSigner != address(0), "Invalid verifyingSigner");
        emit VerifyingSignerChanged(verifyingSigner, _newSigner);
        verifyingSigner = _newSigner;
    }

    function transferOwnership(address _newOwner) external onlyOwner {
        require(_newOwner != address(0), "Invalid owner");
        emit OwnershipTransferred(owner, _newOwner);
        owner = _newOwner;
    }

    /**
     * @notice Validates whether the paymaster will sponsor the UserOperation.
     * Called exclusively by the EntryPoint contract (0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789).
     */
    function validatePaymasterUserOp(
        bytes calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    ) external onlyEntryPoint returns (bytes memory context, uint256 validationData) {
        (userOp, maxCost); // Unused parameters
        
        // Extract paymasterAndData payload: [0..20: PaymasterAddr, 20..26: validUntil, 26..32: validAfter, 32..97: signature]
        bytes calldata paymasterAndData = msg.data[4:]; // Strip selector
        
        if (paymasterAndData.length < 97) {
            return ("", 1); // Signature validation failure code
        }

        uint48 validUntil = uint48(bytes6(paymasterAndData[20:26]));
        uint48 validAfter = uint48(bytes6(paymasterAndData[26:32]));
        bytes calldata signature = paymasterAndData[32:97];

        bytes32 hashToSign = keccak256(
            abi.encodePacked(
                address(this),
                validUntil,
                validAfter,
                userOpHash
            )
        );

        bytes32 ethSignedMessageHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", hashToSign)
        );

        address recoveredSigner = recoverSigner(ethSignedMessageHash, signature);
        bool sigFailed = recoveredSigner != verifyingSigner;

        validationData = (uint256(validAfter) << 208) | (uint256(validUntil) << 160) | (sigFailed ? 1 : 0);
        return ("", validationData);
    }

    function recoverSigner(bytes32 _ethSignedMessageHash, bytes calldata _sig) internal pure returns (address) {
        if (_sig.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(_sig.offset)
            s := calldataload(add(_sig.offset, 32))
            v := byte(0, calldataload(add(_sig.offset, 64)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        return ecrecover(_ethSignedMessageHash, v, r, s);
    }

    /**
     * @notice Deposit ETH into EntryPoint for sponsoring gas fees.
     */
    function deposit() external payable {
        entryPoint.depositTo{value: msg.value}(address(this));
    }

    /**
     * @notice Withdraw deposited ETH from EntryPoint.
     */
    function withdrawTo(address payable withdrawAddress, uint256 amount) external onlyOwner {
        entryPoint.withdrawTo(withdrawAddress, amount);
    }

    receive() external payable {
        if (msg.sender != address(entryPoint)) {
            entryPoint.depositTo{value: msg.value}(address(this));
        }
    }
}
